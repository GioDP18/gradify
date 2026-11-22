/** Header shown only on printed pages (reports and grading sheets). */
export default function PrintHeader({ title, lines = [] }) {
  return (
    <header className="print-only evsu-print-header">
      <div className="evsu-print-header__brand">Gradify — EVSU Grading System</div>
      <div className="evsu-print-header__title">{title}</div>
      {lines.filter(Boolean).map((line) => (
        <div key={line} className="evsu-print-header__line">{line}</div>
      ))}
      <div className="evsu-print-header__line">Printed {new Date().toLocaleString('en-PH')}</div>
    </header>
  );
}
