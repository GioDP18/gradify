import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/common/Toast';
import { createQueryClient } from './queryClient';
import { routes } from './routes/routes';
import { AppErrorBoundary } from './components/common/ErrorBoundary';
import TopProgressBar from './components/common/TopProgressBar';

const router = createBrowserRouter(routes);

/** Provider order: data cache → toasts → auth (auth needs both) → router. */
export function AppProviders({ queryClient, children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppErrorBoundary>
      <AppProviders queryClient={queryClient}>
        <TopProgressBar />
        <RouterProvider router={router} />
      </AppProviders>
    </AppErrorBoundary>
  );
}
