import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { AppProviders } from '../App';
import { routes } from '../routes/routes';

/** Renders the real route tree and providers at `route`, with a fresh cache. */
export function renderApp(route = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [route] });
  const utils = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, router, queryClient };
}

export const instructor = { id: 'u1', name: 'Maria Santos', email: 'maria@evsu.edu.ph', role: 'INSTRUCTOR', status: 'ACTIVE' };
export const student = { id: 'u2', name: 'Juan Dela Cruz', email: 'juan@evsu.edu.ph', role: 'STUDENT', status: 'ACTIVE' };

export const sampleClass = {
  id: 'c1',
  subjectCode: 'IT 101',
  subjectTitle: 'Introduction to Computing',
  section: 'BSIT-1A',
  schoolYear: '2026-2027',
  semester: 'FIRST',
  termEndDate: '2026-12-18T00:00:00.000Z',
  status: 'ACTIVE',
};
