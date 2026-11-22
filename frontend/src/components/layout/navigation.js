import {
  LayoutDashboard,
  School,
  Users,
  CalendarCheck,
  PenLine,
  ClipboardList,
  FileText,
  GraduationCap,
  Settings,
  UserCog,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';

/**
 * Sidebar navigation, grouped by what an instructor is doing. `ready: false` items render
 * disabled (never as dead links); every module is currently available.
 */
export const NAV_GROUPS = [
  { label: null, items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, ready: true }] },
  {
    label: 'Class records',
    items: [
      { to: '/classes', label: 'Classes', icon: School, ready: true },
      { to: '/students', label: 'Students', icon: Users, ready: true },
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck, ready: true },
    ],
  },
  {
    label: 'Assessments',
    items: [
      { to: '/quizzes', label: 'Written Quizzes', icon: PenLine, ready: true },
      { to: '/activities', label: 'Performance Activities', icon: ClipboardList, ready: true },
      { to: '/examinations', label: 'Examinations', icon: FileText, ready: true },
    ],
  },
  { label: 'Results', items: [{ to: '/grading', label: 'Grading', icon: GraduationCap, ready: true }] },
  { label: 'Preferences', items: [{ to: '/settings', label: 'Settings', icon: Settings, ready: true }] },
];

/** The administrator has no classes: accounts, the shared grading criteria, and their profile. */
export const ADMIN_NAV_GROUPS = [
  {
    label: 'Administration',
    items: [
      { to: '/settings/users', label: 'Instructor accounts', icon: UserCog, ready: true },
      { to: '/settings/grading', label: 'Grading criteria', icon: SlidersHorizontal, ready: true },
    ],
  },
  { label: 'Account', items: [{ to: '/settings/profile', label: 'My profile', icon: UserRound, ready: true }] },
];

export const navGroupsFor = (role) => (role === 'ADMIN' ? ADMIN_NAV_GROUPS : NAV_GROUPS);

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
