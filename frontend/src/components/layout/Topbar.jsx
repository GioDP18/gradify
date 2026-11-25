import { useEffect, useRef, useState } from 'react';
import { Link, useMatches } from 'react-router-dom';
import { ChevronDown, ChevronRight, LogOut, Menu, UserRoundCog } from 'lucide-react';
import ActionButton from '../common/ActionButton';
import { useAuth } from '../../context/AuthContext';
import ClassSwitcher from './ClassSwitcher';
import Avatar from '../common/Avatar';

function AccountMenu({ onLogout }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="position-relative" ref={ref}>
      <button
        type="button"
        className="evsu-account-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {/* Same photo (or initials) as the profile page; it updates as soon as the photo changes. */}
        <Avatar user={user} />
        <span className="d-none d-md-inline text-start lh-sm">
          <span className="d-block fw-semibold small">{user?.name}</span>
          <span className="d-block text-muted-evsu" style={{ fontSize: '0.75rem' }}>{user?.role === 'ADMIN' ? 'Administrator' : 'Instructor'}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className="text-muted-evsu" />
      </button>
      {open && (
        <div className="evsu-menu" role="menu">
          <Link to="/settings/profile" role="menuitem" className="evsu-menu__item text-reset text-decoration-none" onClick={() => setOpen(false)}>
            <UserRoundCog size={16} aria-hidden="true" /> Manage profile
          </Link>
          <ActionButton role="menuitem" className="evsu-menu__item" onClick={onLogout} icon={LogOut} spinnerClassName="">
            {' '}Log out
          </ActionButton>
        </div>
      )}
    </div>
  );
}

export default function Topbar({ sidebarId, sidebarOpen, onToggleSidebar, onLogout }) {
  const matches = useMatches();
  const current = [...matches].reverse().find((match) => match.handle?.title);
  const title = current?.handle.title ?? 'Gradify';
  const crumbs = matches.filter((match) => match.handle?.crumb);

  return (
    <header className="evsu-topbar">
      <button
        type="button"
        className="btn btn-link evsu-topbar__menu d-lg-none"
        onClick={onToggleSidebar}
        aria-controls={sidebarId}
        aria-expanded={sidebarOpen}
        aria-label="Open navigation"
      >
        <Menu size={22} aria-hidden="true" />
      </button>

      <div className="evsu-topbar__title">
        <nav aria-label="Breadcrumb" className="d-none d-sm-block">
          <ol className="evsu-breadcrumbs">
            <li><Link to="/">Home</Link></li>
            {crumbs.map((match, index) => (
              <li key={match.id}>
                <ChevronRight size={12} aria-hidden="true" />
                {index === crumbs.length - 1 ? (
                  <span aria-current="page">{match.handle.crumb}</span>
                ) : (
                  <Link to={match.pathname}>{match.handle.crumb}</Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="h5 mb-0 text-truncate">{title}</h1>
      </div>

      <div className="evsu-topbar__actions">
        {/* The class filter belongs to the dashboard; other pages show their class in the page itself. */}
        {matches.some((match) => match.handle?.allClasses) && <ClassSwitcher />}
        <AccountMenu onLogout={onLogout} />
      </div>
    </header>
  );
}
