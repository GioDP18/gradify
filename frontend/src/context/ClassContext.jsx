import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useMatches } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useClasses } from '../hooks/useClasses';
import { safeStorage } from '../utils/storage';

const ClassContext = createContext(null);

/** Switcher value meaning "every active class" (dashboard only). */
export const ALL_CLASSES = 'ALL';

const lastClassKey = (userId) => `evsu.activeClass.${userId}`; // last specific class picked
const scopeKey = (userId) => `evsu.classScope.${userId}`; // ALL_CLASSES or a class id
const pageClassKey = (userId, page) => `evsu.pageClass.${userId}.${page}`; // per-page class (working class off)

/**
 * Which class the instructor is looking at.
 *  - `activeClass`: the class that class-scoped pages (attendance, assessments, grading) work in —
 *    always one specific class (the last one picked, else the first active class).
 *  - `allClasses`: true when the switcher is on "All classes" (the default). Only the dashboard
 *    uses it: it then summarizes every active class instead of one.
 *  - `workingClass` (Settings): when false, pages marked `handle.classPage` each keep their own
 *    class, chosen on that page; `activeClass` / `selectClass` then refer to the current page.
 */
export function ClassProvider({ children }) {
  const { user } = useAuth();
  // Only instructors have classes (the administrator has none).
  const hasClasses = user?.role === 'INSTRUCTOR';
  const classesQuery = useClasses({ enabled: hasClasses });
  const [scope, setScope] = useState(() => (user ? safeStorage.get(scopeKey(user.id)) : null) ?? ALL_CLASSES);
  const [lastClassId, setLastClassId] = useState(() => (user ? safeStorage.get(lastClassKey(user.id)) : null));
  const [pageChoices, setPageChoices] = useState({});

  // Settings → "Use a working class". When off, each class page keeps its own class.
  const workingClass = user?.preferences?.workingClass ?? true;
  const matches = useMatches();
  const page = [...matches].reverse().find((m) => m.handle?.classPage)?.handle.classPage ?? null;
  const ownPage = !workingClass && page ? page : null;

  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const activeClasses = useMemo(() => classes.filter((c) => c.status === 'ACTIVE'), [classes]);

  const scopedClass = scope !== ALL_CLASSES ? activeClasses.find((c) => c.id === scope) : undefined;
  // A remembered class that is gone or archived falls back to "All classes" / the first class.
  const allClasses = !scopedClass;
  const workingOne = scopedClass ?? activeClasses.find((c) => c.id === lastClassId) ?? activeClasses[0] ?? null;
  const pageChoice = ownPage ? pageChoices[ownPage] ?? (user ? safeStorage.get(pageClassKey(user.id, ownPage)) : null) : null;
  const activeClass = ownPage ? activeClasses.find((c) => c.id === pageChoice) ?? activeClasses[0] ?? null : workingOne;

  const selectClass = useCallback(
    (id) => {
      if (ownPage) {
        // Only this page changes class; the others keep theirs.
        setPageChoices((prev) => ({ ...prev, [ownPage]: id }));
        if (user) safeStorage.set(pageClassKey(user.id, ownPage), id);
        return;
      }
      setScope(id);
      if (user) safeStorage.set(scopeKey(user.id), id);
      if (id !== ALL_CLASSES) {
        setLastClassId(id);
        if (user) safeStorage.set(lastClassKey(user.id), id);
      }
    },
    [user, ownPage],
  );

  const value = useMemo(
    () => ({
      classes,
      activeClasses,
      activeClass,
      allClasses,
      selectClass,
      workingClass,
      isLoading: hasClasses && classesQuery.isPending,
      error: classesQuery.error,
    }),
    [classes, activeClasses, activeClass, allClasses, selectClass, workingClass, hasClasses, classesQuery.isPending, classesQuery.error],
  );

  return <ClassContext.Provider value={value}>{children}</ClassContext.Provider>;
}

export function useClassContext() {
  const context = useContext(ClassContext);
  if (!context) throw new Error('useClassContext must be used inside <ClassProvider>');
  return context;
}

export function formatClassLabel(cls) {
  return cls ? `${cls.subjectCode} · ${cls.section}` : '';
}

export const SEMESTER_LABELS = { FIRST: '1st Semester', SECOND: '2nd Semester', SUMMER: 'Summer' };

export function formatTerm(cls) {
  return cls ? `${SEMESTER_LABELS[cls.semester] ?? cls.semester}, SY ${cls.schoolYear}` : '';
}
