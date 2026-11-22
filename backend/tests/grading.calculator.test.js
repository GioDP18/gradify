/**
 * Critical grading tests (Prompt.md §19.3). Expected values come only from the official
 * criteria image, the EVSU Handbook §53.2 table, and the owner-approved examples (design doc §0).
 */
import { describe, it, expect } from 'vitest';
import {
  itemsComponent, attendanceComponent, attendancePercentage, convertPercentage, computePeriod, computeOverall,
  COMPLETION_STATUS, incDeadline,
} from '../src/services/grading/grading.calculator.js';
import { officialConfigurationTemplate } from '../src/services/grading/grading.defaults.js';
import { validateConfiguration } from '../src/services/grading/grading.validation.js';
import { roundHalfUp, stripFloatNoise } from '../src/services/grading/grading.utils.js';

const config = officialConfigurationTemplate();

/** One item whose score/max equals the wanted component percentage exactly. */
const pctItems = (percent) => [{ id: 'x', title: 'Item', maxScore: 100, score: percent }];
const attendanceFor = (percent) => ({ present: percent, absent: 100 - percent, excused: 0, total: 100 });

function periodWith({ attendance, written, performance, exam }, period = 'MIDTERM') {
  return computePeriod({
    configuration: config,
    period,
    inputs: { ATTENDANCE: attendanceFor(attendance), WRITTEN: pctItems(written), PERFORMANCE: pctItems(performance), EXAM: pctItems(exam) },
  });
}

describe('official configuration (from the grading image)', () => {
  it('uses the official component weights for both periods', () => {
    for (const period of ['MIDTERM', 'FINALS']) {
      expect(config.periods[period].components.map((c) => [c.key, c.weight])).toEqual([
        ['ATTENDANCE', 10], ['WRITTEN', 30], ['PERFORMANCE', 20], ['EXAM', 40],
      ]);
    }
    expect(config.periods.MIDTERM.components[3].label).toBe('Exam (Mid-term)');
    expect(config.periods.FINALS.components[3].label).toBe('Exam (Final Exam)');
  });

  it('weights Midterm 40% and Finals 60%, with a 1-year INC window', () => {
    expect(config.periodWeights).toEqual({ MIDTERM: 40, FINALS: 60 });
    expect(config.incompleteRule).toEqual({ complianceMonths: 12, lapseGrade: 5.0 });
  });

  it('is a valid configuration', () => {
    expect(validateConfiguration(config)).toEqual([]);
  });
});

describe('component percentages', () => {
  it('total points: Σ scores ÷ Σ max (owner example 8/10 + 45/50 = 88.33%)', () => {
    const c = itemsComponent([{ id: 'q1', title: 'Quiz 1', maxScore: 10, score: 8 }, { id: 'q2', title: 'Quiz 2', maxScore: 50, score: 45 }]);
    expect(c.rawScore).toBe(53);
    expect(c.maxScore).toBe(60);
    expect(c.percentage).toBeCloseTo(88.3333333, 6);
  });

  it('supports decimal scores without drift', () => {
    const c = itemsComponent([{ id: 'a', title: 'A', maxScore: 10, score: 0.1 }, { id: 'b', title: 'B', maxScore: 10, score: 0.2 }]);
    expect(c.rawScore).toBe(0.3);
  });

  it('treats a missing score as missing — never as zero', () => {
    const c = itemsComponent([{ id: 'q1', title: 'Quiz 1', maxScore: 10, score: 8 }, { id: 'q2', title: 'Quiz 2', maxScore: 10, score: null }]);
    expect(c.percentage).toBeNull();
    expect(c.missingItems).toEqual([{ id: 'q2', title: 'Quiz 2' }]);
    expect(c.rawScore).toBe(8);
  });

  it('an entered zero is a real score', () => {
    expect(itemsComponent([{ id: 'q1', title: 'Quiz 1', maxScore: 10, score: 0 }]).percentage).toBe(0);
  });

  it('attendance counts EXCUSED as present (D1)', () => {
    expect(attendancePercentage({ present: 8, excused: 1, total: 10 })).toBe(90);
    expect(attendanceComponent({ present: 8, absent: 1, excused: 1, total: 10 }).percentage).toBe(90);
    expect(attendanceComponent({ total: 0 }).percentage).toBeNull();
  });
});

describe('percent → grade conversion (Handbook §53.2, D15–D17)', () => {
  const grade = (p) => convertPercentage(p, config.gradeConversion).grade;

  it('maps 95–100 to 1.0 and steps 0.1 per percentage point down to 75 → 3.0', () => {
    expect(grade(100)).toBe(1.0);
    expect(grade(95)).toBe(1.0);
    expect([94, 91, 90, 86, 85, 81, 80, 76, 75].map(grade)).toEqual([1.1, 1.4, 1.5, 1.9, 2.0, 2.4, 2.5, 2.9, 3.0]);
  });

  it('collapses 70–74 to 4.0 and 69 and below to 5.0 (D16)', () => {
    expect([74, 72, 70].map(grade)).toEqual([4.0, 4.0, 4.0]);
    expect([69, 50, 0].map(grade)).toEqual([5.0, 5.0, 5.0]);
  });

  it('rounds the percentage half-up to a whole number first (D17 boundaries)', () => {
    expect(grade(74.5)).toBe(3.0);
    expect(grade(74.4)).toBe(4.0);
    expect(grade(69.5)).toBe(4.0);
    expect(grade(69.4)).toBe(5.0);
    expect(grade(87.5)).toBe(1.7);
    expect(grade(94.5)).toBe(1.0);
  });

  it('is immune to floating-point noise at the boundary', () => {
    const noisy = 74.49999999999999; // what 74.5 can become after float arithmetic
    expect(grade(noisy)).toBe(3.0);
    expect(stripFloatNoise(0.1 + 0.2)).toBe(0.3);
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
  });

  it('attaches the official qualitative remarks', () => {
    const remarks = (p) => convertPercentage(p, config.gradeConversion).remarks;
    expect(remarks(96)).toBe('Excellent');
    expect(remarks(88)).toBe('Superior');
    expect(remarks(83)).toBe('Very Good');
    expect(remarks(78)).toBe('Good');
    expect(remarks(75)).toBe('Passed');
    expect(remarks(72)).toBe('Conditional Failure');
    expect(remarks(60)).toBe('Failure');
  });
});

describe('period grades', () => {
  it('owner example — Midterm: 90/85/88/80 → 84.10% → 2.1', () => {
    const mid = periodWith({ attendance: 90, written: 85, performance: 88, exam: 80 });
    expect(mid.status).toBe(COMPLETION_STATUS.COMPLETE);
    expect(mid.components.map((c) => c.weightedContribution)).toEqual([9, 25.5, 17.6, 32]);
    expect(mid.percentage).toBeCloseTo(84.1, 10);
    expect(mid.grade).toBe(2.1);
    expect(mid.remarks).toBe('Very Good');
  });

  it('owner example — Finals: 100/90/92/86 → 89.80% → 1.5', () => {
    const fin = periodWith({ attendance: 100, written: 90, performance: 92, exam: 86 }, 'FINALS');
    expect(fin.components.map((c) => c.weightedContribution)).toEqual([10, 27, 18.4, 34.4]);
    expect(fin.percentage).toBeCloseTo(89.8, 10);
    expect(fin.grade).toBe(1.5);
  });

  it('every component uses its official weight', () => {
    // 100% in exactly one component isolates that component's weight.
    expect(periodWith({ attendance: 100, written: 0, performance: 0, exam: 0 }).percentage).toBeCloseTo(10, 10);
    expect(periodWith({ attendance: 0, written: 100, performance: 0, exam: 0 }).percentage).toBeCloseTo(30, 10);
    expect(periodWith({ attendance: 0, written: 0, performance: 100, exam: 0 }).percentage).toBeCloseTo(20, 10);
    expect(periodWith({ attendance: 0, written: 0, performance: 0, exam: 100 }).percentage).toBeCloseTo(40, 10);
  });

  it('INC when any required score is missing; lists the missing items; no numeric grade', () => {
    const result = computePeriod({
      configuration: config,
      period: 'MIDTERM',
      inputs: {
        ATTENDANCE: attendanceFor(100),
        WRITTEN: [{ id: 'q1', title: 'Quiz 1', maxScore: 10, score: 10 }, { id: 'q2', title: 'Quiz 2', maxScore: 10, score: null }],
        PERFORMANCE: pctItems(90),
        EXAM: [{ id: 'e1', title: 'Midterm Exam', maxScore: 100, score: null }],
      },
    });
    expect(result.status).toBe(COMPLETION_STATUS.INCOMPLETE);
    expect(result.percentage).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.remarks).toBe('INC');
    expect(result.missingItems).toEqual([
      { component: 'WRITTEN', componentLabel: 'Written Tasks/Quizzes', id: 'q2', title: 'Quiz 2' },
      { component: 'EXAM', componentLabel: 'Exam (Mid-term)', id: 'e1', title: 'Midterm Exam' },
    ]);
  });

  it('not computable when a component has no items or sessions (weights never redistributed)', () => {
    const result = computePeriod({
      configuration: config,
      period: 'MIDTERM',
      inputs: { ATTENDANCE: attendanceFor(100), WRITTEN: pctItems(90), PERFORMANCE: [], EXAM: pctItems(80) },
    });
    expect(result.status).toBe(COMPLETION_STATUS.NOT_COMPUTABLE);
    expect(result.grade).toBeNull();
    expect(result.emptyComponents).toEqual([{ component: 'PERFORMANCE', componentLabel: 'Performance Tasks/Assignments' }]);
  });

  it('DRP overrides everything', () => {
    const result = computePeriod({ configuration: config, period: 'MIDTERM', inputs: {}, dropped: true });
    expect(result.status).toBe(COMPLETION_STATUS.DROPPED);
    expect(result.remarks).toBe('DRP');
    expect(result.grade).toBeNull();
  });
});

describe('overall grade (D2/D14)', () => {
  const mid = periodWith({ attendance: 90, written: 85, performance: 88, exam: 80 });
  const fin = periodWith({ attendance: 100, written: 90, performance: 92, exam: 86 }, 'FINALS');

  it('owner example: 0.4 × 84.10 + 0.6 × 89.80 = 87.52% → 88 → 1.7', () => {
    const overall = computeOverall({ configuration: config, periods: { MIDTERM: mid, FINALS: fin } });
    expect(overall.status).toBe(COMPLETION_STATUS.COMPLETE);
    expect(overall.percentage).toBeCloseTo(87.52, 10);
    expect(overall.roundedPercent).toBe(88);
    expect(overall.grade).toBe(1.7);
    expect(overall.remarks).toBe('Superior');
  });

  it('uses unrounded period percentages, not the period grades (no double rounding)', () => {
    // Midterm 84.4% (displays 2.1) and Finals 89.4% (displays 1.6):
    // overall = 0.4·84.4 + 0.6·89.4 = 87.4 → 87 → 1.8, whereas averaging the displayed grades would differ.
    const m = periodWith({ attendance: 84.4, written: 84.4, performance: 84.4, exam: 84.4 });
    const f = periodWith({ attendance: 89.4, written: 89.4, performance: 89.4, exam: 89.4 }, 'FINALS');
    const overall = computeOverall({ configuration: config, periods: { MIDTERM: m, FINALS: f } });
    expect(overall.percentage).toBeCloseTo(87.4, 9);
    expect(overall.grade).toBe(1.8);
  });

  it('passes at exactly 74.5% overall and fails conditionally at 74.4%', () => {
    const at = (p) => periodWith({ attendance: p, written: p, performance: p, exam: p });
    const pass = computeOverall({ configuration: config, periods: { MIDTERM: at(74.5), FINALS: { ...at(74.5), period: 'FINALS' } } });
    expect(pass.grade).toBe(3.0);
    const cf = computeOverall({ configuration: config, periods: { MIDTERM: at(74.4), FINALS: { ...at(74.4), period: 'FINALS' } } });
    expect(cf.grade).toBe(4.0);
  });

  it('isolates Midterm from Finals: changing Finals never changes the Midterm result', () => {
    const midA = periodWith({ attendance: 90, written: 85, performance: 88, exam: 80 });
    periodWith({ attendance: 0, written: 0, performance: 0, exam: 0 }, 'FINALS');
    expect(midA.percentage).toBeCloseTo(mid.percentage, 12);
  });

  it('is INC if either period is INC, with the union of missing items', () => {
    const incMid = computePeriod({
      configuration: config, period: 'MIDTERM',
      inputs: { ATTENDANCE: attendanceFor(100), WRITTEN: [{ id: 'q1', title: 'Quiz 1', maxScore: 10, score: null }], PERFORMANCE: pctItems(90), EXAM: pctItems(90) },
    });
    const overall = computeOverall({ configuration: config, periods: { MIDTERM: incMid, FINALS: fin }, termEndDate: new Date('2026-12-18'), now: new Date('2027-01-10') });
    expect(overall.status).toBe(COMPLETION_STATUS.INCOMPLETE);
    expect(overall.grade).toBeNull();
    expect(overall.remarks).toBe('INC');
    expect(overall.missingItems).toEqual([expect.objectContaining({ period: 'MIDTERM', title: 'Quiz 1' })]);
    expect(overall.incDeadline.toISOString().slice(0, 10)).toBe('2027-12-18');
  });

  it('an INC lapses to 5.0 one year after the term ends (Handbook §55.1, D18)', () => {
    const incFin = { ...fin, status: COMPLETION_STATUS.INCOMPLETE, percentage: null, missingItems: [{ component: 'EXAM', title: 'Final Exam' }] };
    const before = computeOverall({ configuration: config, periods: { MIDTERM: mid, FINALS: incFin }, termEndDate: new Date('2026-12-18'), now: new Date('2027-12-18T00:00:00Z') });
    expect(before.status).toBe(COMPLETION_STATUS.INCOMPLETE);
    const after = computeOverall({ configuration: config, periods: { MIDTERM: mid, FINALS: incFin }, termEndDate: new Date('2026-12-18'), now: new Date('2027-12-19T00:00:00Z') });
    expect(after.status).toBe(COMPLETION_STATUS.INC_LAPSED);
    expect(after.grade).toBe(5.0);
    expect(after.remarks).toBe('Failure (INC lapsed)');
  });

  it('DRP and not-computable propagate to the overall grade', () => {
    expect(computeOverall({ configuration: config, periods: { MIDTERM: mid, FINALS: fin }, dropped: true }).remarks).toBe('DRP');
    const nc = computePeriod({ configuration: config, period: 'FINALS', inputs: { ATTENDANCE: attendanceFor(100), WRITTEN: [], PERFORMANCE: [], EXAM: [] } });
    expect(computeOverall({ configuration: config, periods: { MIDTERM: mid, FINALS: nc } }).status).toBe(COMPLETION_STATUS.NOT_COMPUTABLE);
  });

  it('computes the INC deadline from the term end date', () => {
    expect(incDeadline(new Date('2026-05-30'), config.incompleteRule).toISOString().slice(0, 10)).toBe('2027-05-30');
  });
});

describe('configuration validation', () => {
  const clone = () => JSON.parse(JSON.stringify(config));

  it('rejects component weights that do not total 100%', () => {
    const c = clone();
    c.periods.MIDTERM.components[0].weight = 15;
    expect(validateConfiguration(c)).toEqual([{ field: 'periods.MIDTERM.components', message: 'MIDTERM component weights must add up to 100%' }]);
  });

  it('rejects period weights that do not total 100%', () => {
    const c = clone();
    c.periodWeights.FINALS = 50;
    expect(validateConfiguration(c).map((e) => e.field)).toEqual(['periodWeights']);
  });

  it('accepts decimal weights that total exactly 100 (no float error)', () => {
    const c = clone();
    c.periods.MIDTERM.components = c.periods.MIDTERM.components.map((comp, i) => ({ ...comp, weight: [33.33, 33.33, 33.34, 0][i] }));
    expect(validateConfiguration(c)).toEqual([]);
  });

  it('rejects gaps and overlaps in the conversion table', () => {
    const gap = clone();
    gap.gradeConversion.table = gap.gradeConversion.table.filter((b) => b.minPercent !== 80);
    expect(validateConfiguration(gap)[0].message).toMatch(/No grade defined .* 80%/);
    const overlap = clone();
    overlap.gradeConversion.table.push({ minPercent: 80, maxPercent: 80, grade: 2.4 });
    expect(validateConfiguration(overlap)[0].message).toMatch(/More than one grade defined for 80%/);
  });

  it('rejects duplicate component sources and bad keys', () => {
    const c = clone();
    c.periods.FINALS.components[1].source = 'attendance';
    c.periods.FINALS.components[2].key = 'bad key';
    const fields = validateConfiguration(c).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['periods.FINALS.components[1].source', 'periods.FINALS.components[2].key']));
  });
});
