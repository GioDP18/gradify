import { stringify } from 'csv-stringify/sync';

/**
 * Neutralizes spreadsheet formula injection (CWE-1236): a cell starting with = + - @ or a
 * control character is prefixed with an apostrophe so Excel/Sheets treat it as text.
 */
export function safeCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Builds a CSV document (UTF-8 BOM so Excel shows accented names correctly). */
export function toCsv(columns, rows) {
  const header = columns.map((c) => safeCell(c.label)); // labels can be instructor-defined
  const body = rows.map((row) => columns.map((c) => safeCell(typeof c.value === 'function' ? c.value(row) : row[c.key])));
  return `﻿${stringify([header, ...body])}`;
}

export function sendCsv(res, filename, csv) {
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'Cache-Control': 'no-store',
  });
  return res.send(csv);
}

export function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}
