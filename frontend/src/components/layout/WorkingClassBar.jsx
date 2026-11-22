import { useId } from 'react';
import { Link, useMatches } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { useClassContext, formatClassLabel, formatTerm } from '../../context/ClassContext';

const termShort = (cls) => `${cls.schoolYear} ${cls.semester === 'SUMMER' ? 'Summer' : cls.semester === 'FIRST' ? '1st' : '2nd'}`;

/**
 * Tells class pages which class they show, so attendance and scores never land in the wrong class.
 *  - Working class on (Settings): a read-only "Working in …" line on pages marked `classScoped`;
 *    the class is changed on the Classes page or with the dashboard filter.
 *  - Working class off: a Class selector on pages marked `classScoped` or `classPicker`; each
 *    page remembers its own choice.
 */
export default function WorkingClassBar() {
  const id = useId();
  const matches = useMatches();
  const { activeClass, activeClasses, selectClass, workingClass } = useClassContext();
  const handles = matches.map((m) => m.handle ?? {});
  const scoped = handles.some((h) => h.classScoped);
  const picker = scoped || handles.some((h) => h.classPicker);
  if (!activeClass) return null;

  if (!workingClass) {
    if (!picker) return null;
    return (
      <div className="evsu-working-class">
        <label htmlFor={id} className="evsu-working-class__label mb-0">Class</label>
        <select id={id} className="form-select form-select-sm evsu-working-class__select" value={activeClass.id} onChange={(e) => selectClass(e.target.value)}>
          {activeClasses.map((cls) => (
            <option key={cls.id} value={cls.id}>{formatClassLabel(cls)} ({termShort(cls)})</option>
          ))}
        </select>
        <span className="evsu-working-class__meta">{activeClass.subjectTitle}, {formatTerm(activeClass)}</span>
      </div>
    );
  }

  if (!scoped) return null;
  return (
    <div className="evsu-working-class" role="note" aria-label="Working class">
      <span className="evsu-working-class__label">Working in</span>
      <strong>{formatClassLabel(activeClass)}</strong>
      <span className="evsu-working-class__meta">{activeClass.subjectTitle}, {formatTerm(activeClass)}</span>
      {activeClasses.length > 1 && (
        <Link to="/classes" className="evsu-working-class__switch">
          <ArrowLeftRight size={14} aria-hidden="true" /> Switch class
        </Link>
      )}
    </div>
  );
}
