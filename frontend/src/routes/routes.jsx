import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import SettingsLayout from '../pages/settings/SettingsLayout';
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './guards';
import SplashScreen from '../components/common/SplashScreen';
import AppLayout from '../components/layout/AppLayout';
import LoginPage from '../pages/auth/LoginPage';
import { ASSESSMENT_TYPES } from '../config/assessmentTypes';
import NotFoundPage from '../pages/system/NotFoundPage';
import { loadingProgress } from '../services/loadingProgress';
import { RouteErrorPage } from '../components/common/ErrorBoundary';

// Pages load on demand (code splitting): each page, and heavy libraries such as the charts,
// are downloaded only when first opened. Login and the app shell stay in the main bundle.
// Navigations run as transitions, so the old page stays visible while the next one downloads;
// the download is reported to the top progress bar so a slow connection is still visible.
const lazyPage = (importer) =>
  lazy(() => {
    loadingProgress.start();
    return importer().finally(() => loadingProgress.done());
  });
const DashboardPage = lazyPage(() => import('../pages/dashboard/DashboardPage'));
const ClassesPage = lazyPage(() => import('../pages/classes/ClassesPage'));
const StudentsPage = lazyPage(() => import('../pages/students/StudentsPage'));
const StudentDetailPage = lazyPage(() => import('../pages/students/StudentDetailPage'));
const AttendancePage = lazyPage(() => import('../pages/attendance/AttendancePage'));
const AttendanceSessionPage = lazyPage(() => import('../pages/attendance/AttendanceSessionPage'));
const AssessmentListPage = lazyPage(() => import('../pages/assessments/AssessmentListPage'));
const AssessmentScoresPage = lazyPage(() => import('../pages/assessments/AssessmentScoresPage'));
const GradingPage = lazyPage(() => import('../pages/grading/GradingPage'));
const GradingSettingsPage = lazyPage(() => import('../pages/grading/GradingSettingsPage'));
const StudentGradeReportPage = lazyPage(() => import('../pages/grading/StudentGradeReportPage'));
const SettingsPage = lazyPage(() => import('../pages/settings/SettingsPage'));
const UsersPage = lazyPage(() => import('../pages/admin/UsersPage'));
const ProfilePage = lazyPage(() => import('../pages/profile/ProfilePage'));
const JoinClassPage = lazyPage(() => import('../pages/public/JoinClassPage'));
const SystemStatusPage = lazyPage(() => import('../pages/system/SystemStatusPage'));

/**
/** "/": the dashboard for instructors; the administrator has no classes and starts at accounts. */
function HomeRoute() {
  const { user } = useAuth();
  if (user?.role === 'ADMIN') return <Navigate to="/settings/users" replace />;
  return <DashboardPage />;
}

/**
 * Route tree. `handle.title` sets the top-bar title; `handle.crumb` adds a breadcrumb.
 * Exported (not just rendered) so tests can mount it in a memory router.
 */
export const routes = [
  {
    path: '/login',
    element: (
      <PublicOnlyRoute>
        <LoginPage />
      </PublicOnlyRoute>
    ),
  },
  // Public (no sign-in): the page a class's QR code opens, where students enroll themselves.
  {
    path: '/join/:token',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <JoinClassPage />
      </Suspense>
    ),
    errorElement: <RouteErrorPage />,
  },
  {
    path: '/system-status',
    element: (
      <Suspense fallback={<SplashScreen />}>
        <SystemStatusPage />
      </Suspense>
    ),
    errorElement: <RouteErrorPage />,
  },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        // Instructors and the administrator share the app shell; each sees only their own areas.
        element: <RoleRoute roles={['INSTRUCTOR', 'ADMIN']} />,
        children: [
          {
            element: <AppLayout />,
            errorElement: <RouteErrorPage />,
            children: [
              {
                // Page-level errors render inside the app shell (sidebar stays usable).
                errorElement: <RouteErrorPage inLayout />,
                children: [
                  { index: true, element: <HomeRoute />, handle: { title: 'Dashboard', allClasses: true } },

                  // Settings: General (instructors), Instructor accounts (administrator), Grading criteria, My profile.
                  {
                    path: 'settings',
                    element: <SettingsLayout />,
                    handle: { crumb: 'Settings' },
                    children: [
                      { index: true, element: <SettingsPage />, handle: { title: 'Settings' } },
                      { path: 'grading', element: <GradingSettingsPage />, handle: { title: 'Grading criteria', crumb: 'Grading criteria' } },
                      { path: 'profile', element: <ProfilePage />, handle: { title: 'My profile', crumb: 'My profile' } },
                      {
                        path: 'users',
                        element: <RoleRoute roles={['ADMIN']} />,
                        children: [{ index: true, element: <UsersPage />, handle: { title: 'Instructor accounts', crumb: 'Instructor accounts' } }],
                      },
                    ],
                  },
                  // Old addresses keep working.
                  { path: 'profile', element: <Navigate to="/settings/profile" replace /> },

                  // Class records: instructors only.
                  {
                    element: <RoleRoute roles={['INSTRUCTOR']} />,
                    children: [
                      { path: 'classes', element: <ClassesPage />, handle: { title: 'Classes', crumb: 'Classes' } },
                      {
                        path: 'students',
                        handle: { crumb: 'Students', classPage: 'students' },
                        children: [
                          { index: true, element: <StudentsPage />, handle: { title: 'Students', classPicker: true } },
                          { path: ':id', element: <StudentDetailPage />, handle: { title: 'Student details', crumb: 'Details' } },
                        ],
                      },
                      {
                        path: 'attendance',
                        handle: { crumb: 'Attendance', classPage: 'attendance' },
                        children: [
                          { index: true, element: <AttendancePage />, handle: { title: 'Attendance', classScoped: true } },
                          { path: ':id', element: <AttendanceSessionPage />, handle: { title: 'Take attendance', crumb: 'Session' } },
                        ],
                      },
                      {
                        path: 'grading',
                        handle: { crumb: 'Grading', classPage: 'grading' },
                        children: [
                          { index: true, element: <GradingPage />, handle: { title: 'Grading', classScoped: true } },
                          { path: 'settings', element: <Navigate to="/settings/grading" replace /> },
                          { path: ':period/student/:studentId', element: <StudentGradeReportPage />, handle: { title: 'Grade report', crumb: 'Report' } },
                        ],
                      },
                      ...Object.values(ASSESSMENT_TYPES).map((type) => ({
                        path: type.path.slice(1),
                        handle: { crumb: type.title, classPage: type.key },
                        children: [
                          { index: true, element: <AssessmentListPage key={type.key} typeKey={type.key} />, handle: { title: type.title, classScoped: true } },
                          { path: ':id', element: <AssessmentScoresPage key={type.key} typeKey={type.key} />, handle: { title: `${type.Singular} scores`, crumb: 'Scores' } },
                        ],
                      })),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
