import { Outlet } from 'react-router-dom';

/**
 * /settings and its sections. The overview (/settings) lists every section; each one opens on its
 * own page (/settings/grading, /settings/profile, /settings/users) with the top-bar breadcrumb
 * leading back.
 */
export default function SettingsLayout() {
  return <Outlet />;
}
