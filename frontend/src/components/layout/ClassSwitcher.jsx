import { useId } from 'react';
import { Link, useMatches } from 'react-router-dom';
import { useClassContext, formatClassLabel, formatTerm, ALL_CLASSES } from '../../context/ClassContext';

const termShort = (cls) => `${cls.schoolYear} ${cls.semester === 'SUMMER' ? 'Summer' : cls.semester === 'FIRST' ? '1st' : '2nd'}`;

/**
 * Picks the class being viewed. Pages that summarize several classes (the dashboard, marked with
 * `handle.allClasses`) also offer "All classes"; pages that work inside one class always show one.
 */
export default function ClassSwitcher() {
  const id = useId();
  const matches = useMatches();
  const { activeClasses, activeClass, allClasses, selectClass, isLoading } = useClassContext();
  const offersAll = matches.some((m) => m.handle?.allClasses);

  if (isLoading) return <span className="small text-muted-evsu">Loading classes…</span>;

  if (activeClasses.length === 0) {
    return (
      <Link to="/classes" className="btn btn-sm btn-outline-primary">
        Create a class
      </Link>
    );
  }

  const showingAll = offersAll && allClasses;
  return (
    <div className="evsu-class-switcher">
      <label htmlFor={id} className="visually-hidden">Active class</label>
      <select
        id={id}
        className="form-select form-select-sm"
        value={showingAll ? ALL_CLASSES : activeClass?.id ?? ''}
        onChange={(event) => selectClass(event.target.value)}
        title={showingAll ? 'Summary of all active classes' : activeClass ? `${activeClass.subjectTitle} — ${formatTerm(activeClass)}` : undefined}
      >
        {offersAll && <option value={ALL_CLASSES}>All classes ({activeClasses.length})</option>}
        {activeClasses.map((cls) => (
          <option key={cls.id} value={cls.id}>
            {formatClassLabel(cls)} ({termShort(cls)})
          </option>
        ))}
      </select>
    </div>
  );
}
