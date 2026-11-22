import { preciseSum } from './grading/grading.utils.js';

const BUCKETS = ['0–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–89', '90–100'];

/**
 * Descriptive statistics for one assessment (display only — not a grading formula).
 * itemPercent = score ÷ maxScore × 100 for a single item.
 */
export function assessmentStatistics(scores, maxScore, totalStudents) {
  const values = scores.map(Number);
  const scoredCount = values.length;
  const distribution = BUCKETS.map((range) => ({ range, count: 0 }));
  for (const v of values) {
    const pct = (v / maxScore) * 100;
    distribution[Math.min(9, Math.floor(pct / 10))].count += 1;
  }
  const average = scoredCount ? preciseSum(values) / scoredCount : null;
  return {
    totalStudents,
    scoredCount,
    missingCount: Math.max(0, totalStudents - scoredCount),
    highest: scoredCount ? Math.max(...values) : null,
    lowest: scoredCount ? Math.min(...values) : null,
    average,
    averagePercent: average === null ? null : (average / maxScore) * 100,
    distribution,
  };
}
