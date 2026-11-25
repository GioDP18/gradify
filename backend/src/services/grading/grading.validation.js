/**
 * Validation of grading configurations (and their versions) before they can be saved.
 * A configuration that fails here can never be activated.
 */
import { COMPONENT_SOURCES } from './grading.defaults.js';
import { decimalPlaces } from './grading.utils.js';

const PERIODS = ['MIDTERM', 'FINALS'];
const SOURCES = Object.values(COMPONENT_SOURCES);

const toCents = (n) => Math.round(n * 100);
const isWeight = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 && decimalPlaces(n) <= 2;

/** Returns a list of { field, message } problems (empty = valid). */
export function validateConfiguration(config) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const PERIOD_NAMES = { MIDTERM: 'Midterm', FINALS: 'Finals' };

  // Period weights (Midterm 40 / Finals 60 officially) must total exactly 100.
  const periodWeights = config.periodWeights ?? {};
  for (const p of PERIODS) if (!isWeight(periodWeights[p])) add(`periodWeights.${p}`, `${PERIOD_NAMES[p]} weight must be a number from 0 to 100, with at most 2 decimal places`);
  if (Object.keys(periodWeights).some((k) => !PERIODS.includes(k))) add('periodWeights', 'Only Midterm and Finals weights are allowed');
  if (PERIODS.every((p) => isWeight(periodWeights[p])) && PERIODS.reduce((s, p) => s + toCents(periodWeights[p]), 0) !== 10000) {
    add('periodWeights', 'Midterm and Finals weights must add up to 100%');
  }

  for (const p of PERIODS) {
    const components = config.periods?.[p]?.components;
    if (!Array.isArray(components) || components.length === 0) {
      add(`periods.${p}.components`, `${PERIOD_NAMES[p]} must have at least one component`);
      continue;
    }
    const keys = new Set();
    const sources = new Set();
    components.forEach((c, i) => {
      const f = `periods.${p}.components[${i}]`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        add(f, 'A component is incomplete');
        return;
      }
      if (!c.key || !/^[A-Z_]{2,30}$/.test(c.key)) add(`${f}.key`, 'A component is not valid');
      if (keys.has(c.key)) add(`${f}.key`, 'A component appears twice');
      keys.add(c.key);
      if (!c.label || typeof c.label !== 'string' || c.label.trim().length === 0 || c.label.length > 60) add(`${f}.label`, 'Each component needs a name of at most 60 characters');
      if (!isWeight(c.weight)) add(`${f}.weight`, 'Weight must be a number from 0 to 100, with at most 2 decimal places');
      if (!SOURCES.includes(c.source)) add(`${f}.source`, 'A component is not linked to attendance, quizzes, activities, or exams');
      if (sources.has(c.source)) add(`${f}.source`, 'Two components use the same records');
      sources.add(c.source);
    });
    if (components.every((c) => c && isWeight(c.weight)) && components.reduce((s, c) => s + toCents(c.weight), 0) !== 10000) {
      add(`periods.${p}.components`, `${PERIOD_NAMES[p]} component weights must add up to 100%`);
    }
  }

  // Conversion table must cover every whole percent 0–100 exactly once, with grades 1.0–5.0.
  const table = config.gradeConversion?.table;
  if (!Array.isArray(table) || table.length === 0) add('gradeConversion.table', 'A conversion table is required');
  else {
    const covered = new Array(101).fill(0);
    table.forEach((band, i) => {
      if (!band || typeof band !== 'object') {
        add(`gradeConversion.table[${i}]`, 'A grade range is not valid');
        return;
      }
      const ok = Number.isInteger(band.minPercent) && Number.isInteger(band.maxPercent) && band.minPercent >= 0 && band.maxPercent <= 100 && band.minPercent <= band.maxPercent;
      if (!ok) add(`gradeConversion.table[${i}]`, 'Each grade range needs whole percentages from 0 to 100, lowest first');
      else for (let p = band.minPercent; p <= band.maxPercent; p += 1) covered[p] += 1;
      if (typeof band.grade !== 'number' || band.grade < 1 || band.grade > 5 || decimalPlaces(band.grade) > 1) add(`gradeConversion.table[${i}].grade`, 'Grade must be from 1.0 to 5.0, with one decimal place');
    });
    const gaps = covered.map((n, p) => (n === 0 ? p : null)).filter((p) => p !== null);
    const overlaps = covered.map((n, p) => (n > 1 ? p : null)).filter((p) => p !== null);
    if (gaps.length) add('gradeConversion.table', `No grade defined for ${gaps.length} percentage value(s), e.g. ${gaps[0]}%`);
    if (overlaps.length) add('gradeConversion.table', `More than one grade defined for ${overlaps[0]}%`);
  }

  const months = config.incompleteRule?.complianceMonths;
  if (!Number.isInteger(months) || months < 1 || months > 60) add('incompleteRule.complianceMonths', 'The INC completion period must be 1 to 60 months');
  const lapse = config.incompleteRule?.lapseGrade;
  if (typeof lapse !== 'number' || lapse < 1 || lapse > 5) add('incompleteRule.lapseGrade', 'The lapsed-INC grade must be from 1.0 to 5.0');

  return errors;
}
