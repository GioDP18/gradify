import { Component } from 'react';
import { useRouteError } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';

function CrashScreen({ inLayout = false }) {
  return (
    <main className={`container ${inLayout ? 'py-4' : 'py-5'} text-center`} style={{ maxWidth: 520 }} role="alert">
      <span className="evsu-state__icon evsu-state__icon--error mb-3" aria-hidden="true"><TriangleAlert size={24} /></span>
      <h1 className="h4">Something went wrong</h1>
      <p className="text-muted-evsu">
        This page ran into an unexpected problem. Your saved data is safe — only unsaved changes on this page may be lost.
      </p>
      <div className="d-flex justify-content-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload page</button>
        <a href="/" className="btn btn-light">Go to dashboard</a>
      </div>
    </main>
  );
}

/** Route-level error element (render errors inside a page). Technical details go to the console only. */
export function RouteErrorPage({ inLayout = false }) {
  const error = useRouteError();
  // eslint-disable-next-line no-console
  console.error('Route error:', error);
  return <CrashScreen inLayout={inLayout} />;
}

/** Last-resort boundary around the whole app (errors outside the router, e.g. in providers). */
export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  render() {
    return this.state.hasError ? <CrashScreen /> : this.props.children;
  }
}
