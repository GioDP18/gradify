/**
 * Official grading mathematics — pure functions, no I/O.
 * Every module that needs a grading formula must call these; nothing else may re-implement them.
 *
 * Rules (docs/PHASE-1-DESIGN.md §0):
 *  D1  Attendance % = (PRESENT + EXCUSED) ÷ sessions × 100
 *  D3  Component %  = Σ scores ÷ Σ max scores × 100 (total points)
 *      Period %     = Σ component % × weight ÷ 100   (weights from the active configuration)
 *  D2/D14 Overall % = Σ period % × period weight ÷ 100 (unrounded), converted once
 *  D5/D17 Full precision throughout; the percentage is rounded half-up to a whole number only
 *         when converting to the 1.0–5.0 grade (1 decimal).
 *  D6/D7  Any missing required score → INC (no numeric grade); missing is never zero.
 *  D8     A component with no items/sessions → grade not computable (weights never redistributed).
 *  D13    Dropped enrollment → DRP.
 *  D18    INC still incomplete after termEndDate + complianceMonths → lapses to 5.0.
 */
import { roundHalfUp, stripFloatNoise, preciseSum, addMonths } from './grading.utils.js';
import { COMPONENT_SOURCES } from './grading.defaults.js';

export const CALCULATION_VERSION = '1.0.0';

export const COMPLETION_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  INCOMPLETE: 'INCOMPLETE', // INC
  NOT_COMPUTABLE: 'NOT_COMPUTABLE',
  DROPPED: 'DROPPED', // DRP
  INC_LAPSED: 'INC_LAPSED', // INC not completed in time → lapse grade (5.0)
});

/** D1 — returns null when there are no sessions (never 0). */
export function attendancePercentage({ present = 0, excused = 0, total = 0 }) {
  if (!total) return null;
  return ((present + excused) / total) * 100;
}

/**
 * D3 — total-points component. items: [{ id, title, maxScore, score }] where score is a number
 * or null/undefined when no score was entered (missing — NOT zero).
 */
export function itemsComponent(items) {
  const missing = items.filter((item) => item.score === null || item.score === undefined);
  const scored = items.filter((item) => !missing.includes(item));
  const rawScore = preciseSum(scored.map((i) => i.score));
  const maxScore = preciseSum(items.map((i) => i.maxScore));
  return {
    itemCount: items.length,
    scoredCount: scored.length,
    rawScore,
    maxScore,
    missingItems: missing.map((i) => ({ id: i.id, title: i.title })),
    percentage: items.length > 0 && missing.length === 0 && maxScore > 0 ? (rawScore / maxScore) * 100 : null,
  };
}

export function attendanceComponent({ present = 0, absent = 0, excused = 0, total = 0 } = {}) {
  return {
    itemCount: total,
    scoredCount: total,
    rawScore: present + excused,
    maxScore: total,
    present,
    absent,
    excused,
    missingItems: [],
    percentage: attendancePercentage({ present, excused, total }),
  };
}

/** Percent → { grade, remarks } via the configuration's conversion table (D15–D17). */
export function convertPercentage(percentage, gradeConversion) {
  if (percentage === null || percentage === undefined) return { roundedPercent: null, grade: null, remarks: null };
  const roundedPercent = roundHalfUp(stripFloatNoise(percentage), 0);
  const band = gradeConversion.table.find((b) => roundedPercent >= b.minPercent && roundedPercent <= b.maxPercent);
  if (!band) throw new Error(`No grade conversion band covers ${roundedPercent}%`);
  const grade = roundHalfUp(band.grade, 1);
  return { roundedPercent, grade, remarks: remarksForGrade(grade, gradeConversion.remarks) };
}

export function remarksForGrade(grade, remarks) {
  if (grade === null || grade === undefined) return null;
  return remarks.find((r) => grade >= r.minGrade - 1e-9 && grade <= r.maxGrade + 1e-9)?.label ?? null;
}

/**
 * Computes one grading period for one student.
 * inputs: { ATTENDANCE: {present, absent, excused, total}, WRITTEN: items[], PERFORMANCE: items[], EXAM: items[] }
 *         (keys follow the configuration's component keys; sources tell how to read each one)
 */
export function computePeriod({ configuration, period, inputs, dropped = false }) {
  const periodConfig = configuration.periods[period];
  if (!periodConfig) throw new Error(`Configuration has no rules for period ${period}`);

  const components = periodConfig.components.map((component) => {
    const input = inputs[component.key];
    const result = component.source === COMPONENT_SOURCES.ATTENDANCE ? attendanceComponent(input) : itemsComponent(input ?? []);
    const empty = result.itemCount === 0;
    return {
      key: component.key,
      label: component.label,
      weight: component.weight,
      ...result,
      empty,
      weightedContribution: result.percentage === null ? null : (result.percentage * component.weight) / 100,
    };
  });

  const missingItems = components.flatMap((c) => c.missingItems.map((m) => ({ component: c.key, componentLabel: c.label, ...m })));
  const emptyComponents = components.filter((c) => c.empty).map((c) => ({ component: c.key, componentLabel: c.label }));

  let status = COMPLETION_STATUS.COMPLETE;
  if (dropped) status = COMPLETION_STATUS.DROPPED;
  else if (emptyComponents.length) status = COMPLETION_STATUS.NOT_COMPUTABLE;
  else if (missingItems.length) status = COMPLETION_STATUS.INCOMPLETE;

  // Full-precision sum (D5); float noise is removed only at the final conversion step.
  const percentage = status === COMPLETION_STATUS.COMPLETE ? components.reduce((sum, c) => sum + c.weightedContribution, 0) : null;
  const { roundedPercent, grade, remarks } = convertPercentage(percentage, configuration.gradeConversion);

  return {
    period,
    label: periodConfig.label,
    status,
    components,
    missingItems,
    emptyComponents,
    percentage, // full precision
    roundedPercent,
    grade, // display equivalent for the period (D14); never fed into the overall grade
    remarks: displayRemarks(status, remarks),
  };
}

function displayRemarks(status, remarks) {
  if (status === COMPLETION_STATUS.DROPPED) return 'DRP';
  if (status === COMPLETION_STATUS.INCOMPLETE) return 'INC';
  if (status === COMPLETION_STATUS.NOT_COMPUTABLE) return 'Not computable';
  return remarks;
}

/** Deadline for completing an INC: termEndDate + complianceMonths (D18). */
export function incDeadline(termEndDate, incompleteRule) {
  return termEndDate ? addMonths(termEndDate, incompleteRule.complianceMonths) : null;
}

/**
 * Overall (subject) grade from the two unrounded period percentages (D2/D14).
 * An INC past its deadline lapses to the configured lapse grade (D18).
 */
export function computeOverall({ configuration, periods, dropped = false, termEndDate = null, now = new Date() }) {
  const periodKeys = Object.keys(configuration.periodWeights);
  const results = periodKeys.map((key) => periods[key]);
  const missingItems = results.flatMap((r) => (r?.missingItems ?? []).map((m) => ({ period: r.period, ...m })));
  const deadline = incDeadline(termEndDate, configuration.incompleteRule);

  const base = { missingItems, incDeadline: deadline, percentage: null, roundedPercent: null, grade: null };

  if (dropped || results.some((r) => r?.status === COMPLETION_STATUS.DROPPED)) {
    return { ...base, status: COMPLETION_STATUS.DROPPED, remarks: 'DRP' };
  }
  if (results.some((r) => !r || r.status === COMPLETION_STATUS.NOT_COMPUTABLE)) {
    return { ...base, status: COMPLETION_STATUS.NOT_COMPUTABLE, remarks: 'Not computable' };
  }
  if (results.some((r) => r.status === COMPLETION_STATUS.INCOMPLETE)) {
    if (deadline && now > deadline) {
      const grade = roundHalfUp(configuration.incompleteRule.lapseGrade, 1);
      return { ...base, status: COMPLETION_STATUS.INC_LAPSED, grade, remarks: `${remarksForGrade(grade, configuration.gradeConversion.remarks) ?? 'Failure'} (INC lapsed)` };
    }
    return { ...base, status: COMPLETION_STATUS.INCOMPLETE, remarks: 'INC' };
  }

  const percentage = periodKeys.reduce((sum, key) => sum + (periods[key].percentage * configuration.periodWeights[key]) / 100, 0);
  const { roundedPercent, grade, remarks } = convertPercentage(percentage, configuration.gradeConversion);
  return { ...base, status: COMPLETION_STATUS.COMPLETE, percentage, roundedPercent, grade, remarks };
}
