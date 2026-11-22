import { useEffect, useRef, useState } from 'react';
import { CircleCheck, FileUp, TriangleAlert, Download } from 'lucide-react';
import Modal from '../common/Modal';
import Spinner from '../common/Spinner';
import { formatClassLabel } from '../../context/ClassContext';
import { saveBlob } from '../../utils/download';

const TEMPLATE = 'Student Number,Last Name,First Name,Middle Name,Email,Course,Year Level,Section\n2026-00001,Dela Cruz,Juan,Protacio,,BSIT,1,A\n';

/**
 * Two-step CSV import: the file is checked first (dry run, nothing saved), the instructor
 * reviews row-level errors, then confirms. Invalid rows are only skipped when explicitly chosen.
 */
export default function ImportStudentsModal({ open, activeClass, onClose, onImport }) {
  const [file, setFile] = useState(null);
  const [enroll, setEnroll] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setReport(null);
      setError(null);
      setEnroll(true);
    }
  }, [open]);

  const options = (extra) => ({ classId: enroll && activeClass ? activeClass.id : undefined, ...extra });

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await onImport(file, options({ dryRun: true })));
    } catch (err) {
      setReport(null);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onImport(file, options({ skipInvalid: report.invalidRows > 0 }), { final: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const validCount = report ? report.toCreate + report.toEnrollExisting : 0;

  return (
    <Modal
      open={open}
      size="lg"
      title="Import students from CSV"
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancel</button>
          {!report ? (
            <button type="button" className="btn btn-primary" onClick={check} disabled={!file || busy}>
              {busy && <Spinner size="sm" label="" className="me-2" />}
              Check file
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || validCount === 0}>
              {busy && <Spinner size="sm" label="" className="me-2" />}
              {report.invalidRows > 0 ? `Import ${validCount} valid row${validCount === 1 ? '' : 's'}, skip ${report.invalidRows}` : `Import ${validCount} student${validCount === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      }
    >
      <p className="small text-muted-evsu">
        Required columns: Student Number, First Name, Last Name, Course, Year Level, Section. Optional: Middle Name, Email, Status.
        <button type="button" className="btn btn-link btn-sm p-0 ms-2 align-baseline d-inline-flex align-items-center gap-1" onClick={() => saveBlob(new Blob([TEMPLATE], { type: 'text/csv' }), 'evsu-student-import-template.csv')}>
          <Download size={14} aria-hidden="true" /> Download template
        </button>
      </p>

      <div className="mb-3">
        <label htmlFor="import-file" className="form-label">CSV file (max 1 MB)</label>
        <input
          ref={inputRef}
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          className="form-control"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setReport(null);
            setError(null);
          }}
        />
      </div>

      {activeClass && (
        <div className="form-check mb-3">
          <input id="import-enroll" type="checkbox" className="form-check-input" checked={enroll} disabled={busy}
            onChange={(e) => { setEnroll(e.target.checked); setReport(null); }} />
          <label htmlFor="import-enroll" className="form-check-label">
            Enroll imported students in <strong>{formatClassLabel(activeClass)}</strong>
            <span className="d-block small text-muted-evsu">Students already in your roster (same student number) are enrolled instead of duplicated.</span>
          </label>
        </div>
      )}

      {error && (
        <div className="alert alert-danger small" role="alert">
          <strong>{error.message}</strong>
          {Array.isArray(error.details) && (
            <ul className="mb-0 mt-1">
              {error.details.map((d) => <li key={`${d.field}-${d.message}`}>{d.message}</li>)}
            </ul>
          )}
        </div>
      )}

      {report && (
        <section aria-label="Import check results">
          <div className="d-flex flex-wrap gap-2 mb-3">
            <span className="evsu-status evsu-status--ok"><CircleCheck size={14} aria-hidden="true" /> {report.toCreate} new</span>
            {report.toEnrollExisting > 0 && <span className="evsu-status evsu-status--info"><FileUp size={14} aria-hidden="true" /> {report.toEnrollExisting} existing to enroll</span>}
            <span className={`evsu-status ${report.invalidRows ? 'evsu-status--error' : 'evsu-status--neutral'}`}>
              <TriangleAlert size={14} aria-hidden="true" /> {report.invalidRows} invalid
            </span>
            <span className="small text-muted-evsu align-self-center">{report.totalRows} rows checked · nothing saved yet</span>
          </div>

          {report.errors.length > 0 && (
            <div className="evsu-table-wrap mb-3" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="table evsu-table mb-0">
                <caption className="visually-hidden">Rows with errors</caption>
                <thead><tr><th scope="col">Line</th><th scope="col">Student no.</th><th scope="col">Problem</th></tr></thead>
                <tbody>
                  {report.errors.map((row) => (
                    <tr key={row.row}>
                      <td data-label="Line">{row.row}</td>
                      <td data-label="Student no.">{row.studentNumber || '—'}</td>
                      <td data-label="Problem" className="text-danger">{row.errors.map((e) => e.message).join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.warnings.length > 0 && (
            <div className="alert alert-warning small">
              <ul className="mb-0">
                {report.warnings.map((w) => <li key={w.row}>Line {w.row} ({w.studentNumber}): {w.message}</li>)}
              </ul>
            </div>
          )}
          {report.invalidRows > 0 && validCount > 0 && (
            <p className="small text-muted-evsu mb-0">You can fix the file and choose it again, or import only the valid rows.</p>
          )}
        </section>
      )}
    </Modal>
  );
}
