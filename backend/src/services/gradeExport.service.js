/**
 * Grade sheet and report exports (CSV / Excel).
 * Uses ONLY the grading engine's persisted results (via grading.service) — no formula here.
 * Percentages are shown to 2 decimals for readability; official grades come from the engine.
 */
import ExcelJS from 'exceljs';
import { toCsv, safeCell, dateStamp } from '../utils/csv.js';
import { getClassGrades, getStudentGrade } from './grading/grading.service.js';

const PERIOD_LABEL = { MIDTERM: 'Midterm', FINALS: 'Finals', OVERALL: 'Overall (Final Grade)' };
const SEMESTER_LABEL = { FIRST: '1st Semester', SECOND: '2nd Semester', SUMMER: 'Summer' };

const pct = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2));
const gradeText = (row) => (row.grade === null || row.grade === undefined ? '' : Number(row.grade).toFixed(1));

/** What to show when there is no numeric grade. */
function statusText(row) {
  if (!row.current) return row.calcStatus === 'FAILED' ? 'Pending (recalculation failed)' : 'Pending recalculation';
  switch (row.completionStatus) {
    case 'INCOMPLETE': return 'INC';
    case 'DROPPED': return 'DRP';
    case 'NOT_COMPUTABLE': return 'Not computable';
    default: return row.remarks ?? '';
  }
}

const missingText = (row) => (row.missingItems ?? []).map((m) => `${m.period ? `${PERIOD_LABEL[m.period]}: ` : ''}${m.title}`).join('; ');

function header(cls, period, configuration) {
  return [
    ['Gradify — EVSU Grading System'],
    [`Class Grading Sheet — ${PERIOD_LABEL[period]}`],
    [`${cls.subjectCode} · ${cls.section} · ${SEMESTER_LABEL[cls.semester] ?? cls.semester}, SY ${cls.schoolYear}`],
    [weightsLine(period, configuration)],
    [`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · grading rules version ${configuration.version}`],
  ];
}

function weightsLine(period, configuration) {
  if (period === 'OVERALL') return `Official weights: Midterm ${configuration.periodWeights.MIDTERM}% · Finals ${configuration.periodWeights.FINALS}%`;
  return `Official weights: ${configuration.periods[period].components.map((c) => `${c.label} ${c.weight}%`).join(' · ')}`;
}

/** Column definitions shared by CSV and Excel. */
function sheetColumns(period, configuration) {
  const base = [
    { label: 'Student Number', value: (r) => r.studentNumber },
    { label: 'Student Name', value: (r) => r.fullName },
  ];
  let middle;
  if (period === 'OVERALL') {
    middle = ['MIDTERM', 'FINALS'].flatMap((p) => [
      { label: `${PERIOD_LABEL[p]} % (${configuration.periodWeights[p]}%)`, value: (r) => (r.current ? pct(r.periodResults?.[p]?.percentage) : '') },
      { label: `${PERIOD_LABEL[p]} Grade`, value: (r) => (r.current && r.periodResults?.[p]?.grade != null ? Number(r.periodResults[p].grade).toFixed(1) : '') },
    ]);
  } else {
    middle = configuration.periods[period].components.map((c) => ({
      label: `${c.label} % (${c.weight}%)`,
      value: (r) => (r.current ? pct(r.components.find((x) => x.key === c.key)?.percentage) : ''),
    }));
  }
  return [
    ...base,
    ...middle,
    { label: 'Computed %', value: (r) => (r.current ? pct(r.percentage) : '') },
    { label: 'Grade', value: (r) => (r.current ? gradeText(r) : '') },
    { label: 'Remarks', value: statusText },
    { label: 'Missing Requirements', value: missingText },
  ];
}

async function workbookBuffer(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gradify — EVSU Grading System';
  wb.created = new Date();
  for (const { name, preamble, columns, rows } of sheets) {
    const ws = wb.addWorksheet(name.slice(0, 31));
    preamble.forEach((line, i) => {
      const row = ws.addRow(line.map(safeCell));
      if (i === 0) row.font = { bold: true, size: 14, color: { argb: 'FF7B1416' } };
      else if (i === 1) row.font = { bold: true, size: 12 };
      else row.font = { size: 10, color: { argb: 'FF5F6B7A' } };
    });
    ws.addRow([]);
    const head = ws.addRow(columns.map((c) => c.label));
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B1416' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    for (const r of rows) ws.addRow(columns.map((c) => safeCell(c.value(r))));
    columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = Math.min(45, Math.max(12, c.label.length + 2));
    });
    ws.views = [{ state: 'frozen', ySplit: preamble.length + 2 }];
  }
  return wb.xlsx.writeBuffer();
}

function csvWithPreamble(preamble, columns, rows) {
  const pre = preamble.map((line) => line.map((v) => `"${String(safeCell(v)).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  return `﻿${pre}\r\n\r\n${toCsv(columns, rows).replace(/^﻿/, '')}`;
}

const filePart = (text) => String(text).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function exportClassSheet(instructorId, classId, periodParam, format) {
  const data = await getClassGrades(instructorId, classId, periodParam);
  const columns = sheetColumns(data.period, data.configuration);
  const preamble = header(data.class, data.period, data.configuration);
  const base = `evsu-grades-${filePart(data.class.subjectCode)}-${filePart(data.class.section)}-${data.period.toLowerCase()}-${dateStamp()}`;
  if (format === 'xlsx') {
    return { filename: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: await workbookBuffer([{ name: PERIOD_LABEL[data.period], preamble, columns, rows: data.rows }]) };
  }
  return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: csvWithPreamble(preamble, columns, data.rows) };
}

/** Breakdown rows for one period of an individual report. */
function breakdownRows(row) {
  return row.components.map((c) => ({
    component: c.label,
    raw: c.key === 'ATTENDANCE' ? `${c.rawScore} (P ${c.present ?? 0}, E ${c.excused ?? 0}, A ${c.absent ?? 0})` : c.rawScore,
    max: c.maxScore,
    percentage: pct(c.percentage),
    weight: `${c.weight}%`,
    contribution: pct(c.weightedContribution),
  }));
}

const BREAKDOWN_COLUMNS = [
  { label: 'Component', key: 'component' },
  { label: 'Raw Score', key: 'raw' },
  { label: 'Maximum Possible', key: 'max' },
  { label: 'Percentage', key: 'percentage' },
  { label: 'Official Weight', key: 'weight' },
  { label: 'Weighted Contribution', key: 'contribution' },
].map((c) => ({ ...c, value: (r) => r[c.key] }));

export async function exportStudentReport(instructorId, classId, periodParam, studentId, format) {
  const data = await getStudentGrade(instructorId, classId, periodParam, studentId);
  const g = data.grade;
  const s = g.student;
  const preamble = [
    ['Gradify — EVSU Grading System'],
    [`Individual Grade Report — ${PERIOD_LABEL[data.period]}`],
    [`${s.studentNumber} · ${s.fullName} · ${s.course} ${s.yearLevel}-${s.section}`],
    [`${data.class.subjectCode} ${data.class.subjectTitle} · ${data.class.section} · ${SEMESTER_LABEL[data.class.semester] ?? data.class.semester}, SY ${data.class.schoolYear}`],
    [`Result: ${g.current ? `${pct(g.percentage)}% → ${gradeText(g) || '—'} (${statusText(g)})` : statusText(g)}${missingText(g) ? ` · Missing: ${missingText(g)}` : ''}`],
    [`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · grading rules version ${data.configuration.version}`],
  ];

  const sheets = [];
  if (data.period === 'OVERALL') {
    for (const p of ['MIDTERM', 'FINALS']) {
      const pr = g.periods?.[p];
      if (!pr) continue;
      sheets.push({
        name: PERIOD_LABEL[p],
        preamble: [...preamble, [`${PERIOD_LABEL[p]}: ${pr.current ? `${pct(pr.percentage)}% → ${gradeText(pr) || '—'} (${statusText(pr)})` : statusText(pr)} · weight ${data.configuration.periodWeights[p]}% of the final grade`]],
        columns: BREAKDOWN_COLUMNS,
        rows: breakdownRows(pr),
      });
    }
  } else {
    sheets.push({ name: PERIOD_LABEL[data.period], preamble, columns: BREAKDOWN_COLUMNS, rows: breakdownRows(g) });
  }

  const base = `evsu-grade-report-${filePart(s.studentNumber)}-${filePart(data.class.subjectCode)}-${data.period.toLowerCase()}-${dateStamp()}`;
  if (format === 'xlsx') {
    return { filename: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: await workbookBuffer(sheets) };
  }
  const body = sheets.map((sh) => csvWithPreamble(sh.preamble, sh.columns, sh.rows).replace(/^﻿/, '')).join('\r\n\r\n');
  return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: `﻿${body}` };
}
