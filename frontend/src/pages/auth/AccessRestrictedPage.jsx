import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/** Shown to signed-in users (e.g. students) who try to open instructor-only pages. */
export default function AccessRestrictedPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <main className="container py-5 text-center" style={{ maxWidth: 520 }}>
      <span className="evsu-state__icon evsu-state__icon--error mb-3" aria-hidden="true">
        <ShieldAlert size={24} />
      </span>
      <h1 className="h4">Access restricted</h1>
      <p className="text-muted-evsu">
        This area is for instructors only.
        {user?.role === 'STUDENT' && ' Student features are not available yet.'}
      </p>
      <p className="small text-muted-evsu">Signed in as {user?.email}</p>
      <button type="button" className="btn btn-primary" onClick={handleLogout}>
        Sign out
      </button>
    </main>
  );
}
