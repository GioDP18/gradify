/**
 * THE OFFICIAL EVSU GRADING CRITERIA — the only place in the codebase where official weights,
 * conversion rules, and remarks are written down. They seed each instructor's version 1
 * grading configuration (stored in MongoDB, versioned). Nothing else may hard-code them.
 *
 * Sources:
 *  - Official "Criteria for Grading" image (component and period weights, INC note).
 *  - EVSU 2017 Revised Students' Handbook §53.2 (undergraduate scale), §53c/§55.1 (INC lapse).
 *  - Owner decisions D1–D19 in docs/PHASE-1-DESIGN.md §0.
 */

export const COMPONENT_SOURCES = Object.freeze({
  ATTENDANCE: 'attendance',
  WRITTEN: 'writtenQuizzes',
  PERFORMANCE: 'performanceActivities',
  EXAM: 'examinations',
});

/** Percent → numeric grade table (D15–D17): rounded whole percent looked up in these bands. */
function buildConversionTable() {
  const table = [{ minPercent: 95, maxPercent: 100, grade: 1.0 }];
  for (let p = 94; p >= 75; p -= 1) table.push({ minPercent: p, maxPercent: p, grade: (105 - p) / 10 }); // 94→1.1 … 75→3.0
  table.push({ minPercent: 70, maxPercent: 74, grade: 4.0 }); // D16 collapsed Conditional Failure
  table.push({ minPercent: 0, maxPercent: 69, grade: 5.0 }); // D16 collapsed Failure
  return table;
}

/** Handbook §53.2 qualitative equivalents. */
export const DEFAULT_REMARKS = Object.freeze([
  { minGrade: 1.0, maxGrade: 1.4, label: 'Excellent' },
  { minGrade: 1.5, maxGrade: 1.9, label: 'Superior' },
  { minGrade: 2.0, maxGrade: 2.4, label: 'Very Good' },
  { minGrade: 2.5, maxGrade: 2.9, label: 'Good' },
  { minGrade: 3.0, maxGrade: 3.0, label: 'Passed' },
  { minGrade: 3.1, maxGrade: 4.0, label: 'Conditional Failure' },
  { minGrade: 4.1, maxGrade: 5.0, label: 'Failure' },
]);

const components = (examLabel) => [
  { key: 'ATTENDANCE', label: 'Attendance', weight: 10, source: COMPONENT_SOURCES.ATTENDANCE },
  { key: 'WRITTEN', label: 'Written Tasks/Quizzes', weight: 30, source: COMPONENT_SOURCES.WRITTEN },
  { key: 'PERFORMANCE', label: 'Performance Tasks/Assignments', weight: 20, source: COMPONENT_SOURCES.PERFORMANCE },
  { key: 'EXAM', label: examLabel, weight: 40, source: COMPONENT_SOURCES.EXAM },
];

export function officialConfigurationTemplate() {
  return {
    name: 'EVSU Official Criteria for Grading',
    source: 'Official Criteria for Grading (image) + EVSU Students’ Handbook §53.2; owner decisions D1–D19',
    periodWeights: { MIDTERM: 40, FINALS: 60 },
    periods: {
      MIDTERM: { label: 'Midterm Grade', components: components('Exam (Mid-term)') },
      FINALS: { label: 'Final Grade', components: components('Exam (Final Exam)') },
    },
    computationRules: {
      componentAggregation: 'TOTAL_POINTS', // D3: Σ scores ÷ Σ max × 100
      attendanceFormula: 'PRESENT_PLUS_EXCUSED_OVER_SESSIONS', // D1
      missingScorePolicy: 'INC', // D6/D7: any missing required score → INC, never zero
      emptyComponentPolicy: 'NOT_COMPUTABLE', // D8: no redistribution of weights
      overallFormula: 'WEIGHTED_PERIOD_PERCENTAGES', // D2/D14
    },
    roundingRules: {
      percentBeforeConversion: 'HALF_UP_TO_WHOLE_PERCENT', // D17
      gradeDecimals: 1, // D5
      intermediateRounding: 'NONE', // D5: full precision until the final step
    },
    gradeConversion: {
      scale: 'UNDERGRADUATE_SECTION_53_2',
      table: buildConversionTable(),
      remarks: DEFAULT_REMARKS.map((r) => ({ ...r })),
      passingGrade: 3.0,
    },
    incompleteRule: { complianceMonths: 12, lapseGrade: 5.0 }, // image note + Handbook §55.1 (D18)
  };
}
