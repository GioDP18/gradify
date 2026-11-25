import { Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import WorkingClassBar from './WorkingClassBar';
import { useAuth } from '../../context/AuthContext';
import { ClassProvider } from '../../context/ClassContext';
import { useToast } from '../common/Toast';
import { FullPageSpinner } from '../common/Spinner';
import './layout.css';
import '../../styles/app-chrome.css';

const SIDEBAR_ID = 'evsu-sidebar';

/** Authenticated instructor shell: sidebar (drawer on small screens), top bar, page content. */
export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setSidebarOpen(false), [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch {
      toast.error('Could not sign out. You are still signed in. Check your internet and try again.');
      return;
    }
    toast.info('You have been logged out.');
    navigate('/login', { replace: true });
  }, [logout, navigate, toast]);

  return (
    <ClassProvider>
      <div className="evsu-shell">
        <a href="#main-content" className="evsu-skip-link">Skip to main content</a>
        <Sidebar id={SIDEBAR_ID} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={handleLogout} />
        {sidebarOpen && <div className="evsu-drawer-backdrop d-lg-none" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
        <div className="evsu-main">
          <Topbar
            sidebarId={SIDEBAR_ID}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            onLogout={handleLogout}
          />
          <main id="main-content" className="evsu-content" tabIndex={-1}>
            <WorkingClassBar />
            <Suspense fallback={<FullPageSpinner label="Loading page…" />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </ClassProvider>
  );
}
