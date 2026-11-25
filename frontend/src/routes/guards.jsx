import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AUTH_STATUS, useAuth } from '../context/AuthContext';
import SplashScreen from '../components/common/SplashScreen';
import AccessRestrictedPage from '../pages/auth/AccessRestrictedPage';

/** Requires a signed-in user; otherwise sends them to /login and remembers where they were going. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === AUTH_STATUS.LOADING) return <SplashScreen label="Checking your session…" />;
  if (status === AUTH_STATUS.ANONYMOUS) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/** Shows the access-restricted page to authenticated users without the required role. */
export function RoleRoute({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <AccessRestrictedPage />;
  return <Outlet />;
}

/** Login page is only for signed-out users. */
export function PublicOnlyRoute({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === AUTH_STATUS.LOADING) return <SplashScreen label="Checking your session…" />;
  if (status === AUTH_STATUS.AUTHENTICATED) {
    // Return to the page the user originally asked for (set by ProtectedRoute), never back to /login.
    const from = location.state?.from;
    const destination = typeof from === 'string' && from.startsWith('/') && !from.startsWith('/login') ? from : '/';
    return <Navigate to={destination} replace />;
  }
  return children;
}
