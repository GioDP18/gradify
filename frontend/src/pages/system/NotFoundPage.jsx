import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="container py-5 text-center" style={{ maxWidth: 480 }}>
      <p className="text-muted-evsu fw-semibold mb-1">404</p>
      <h1 className="h4">Page not found</h1>
      <p className="text-muted-evsu">The page you’re looking for doesn’t exist or has moved.</p>
      <Link to="/" className="btn btn-primary">Go to home</Link>
    </main>
  );
}
