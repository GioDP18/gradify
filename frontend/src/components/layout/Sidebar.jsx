import { Link, NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { navGroupsFor } from './navigation';
import { useAuth } from '../../context/AuthContext';
import emblem from '../../assets/brand/gradify-emblem.webp';

export function BrandLockup() {
  return (
    <>
      <span className="evsu-sidebar__medallion">
        <img src={emblem} alt="" className="evsu-sidebar__emblem" width="46" height="41" />
      </span>
      <span>
        <span className="evsu-sidebar__name">Gradify</span>
        <span className="evsu-sidebar__muted">EVSU Grading System</span>
      </span>
    </>
  );
}

export default function Sidebar({ id, open, onClose }) {
  const { user } = useAuth();
  return (
    <aside id={id} className={`evsu-sidebar ${open ? 'is-open' : ''}`} aria-label="Main navigation">
      <div className="evsu-sidebar__head">
        <Link to="/" className="evsu-sidebar__brand flex-grow-1" aria-label="Gradify — EVSU Grading System, go to dashboard" onClick={onClose}>
          <BrandLockup />
        </Link>
        <button type="button" className="btn btn-link evsu-sidebar__close d-lg-none me-2" onClick={onClose} aria-label="Close navigation">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <nav className="evsu-sidebar__nav" aria-label="Sections">
        {navGroupsFor(user?.role).map((group) => (
          <div key={group.label ?? 'top'}>
            {group.label && <div className="evsu-sidebar__group" aria-hidden="true">{group.label}</div>}
            <ul className="list-unstyled mb-0">
              {group.items.map(({ to, label, icon: Icon, end, ready }) => (
                <li key={to}>
                  {ready ? (
                    <NavLink to={to} end={end} className="evsu-nav-link" onClick={onClose}>
                      <Icon size={18} aria-hidden="true" />
                      <span>{label}</span>
                    </NavLink>
                  ) : (
                    <span className="evsu-nav-link is-disabled" aria-disabled="true" title="Available in an upcoming release">
                      <Icon size={18} aria-hidden="true" />
                      <span>{label}</span>
                      <span className="evsu-nav-soon">Soon</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Signing out is in the account menu at the top right. */}
      <footer className="evsu-sidebar__footer">
        <p className="evsu-sidebar__foot-name">Eastern Visayas State University</p>
        <p className="evsu-sidebar__foot-note">&copy; {new Date().getFullYear()} Gradify &middot; EVSU Grading System</p>
      </footer>
    </aside>
  );
}
