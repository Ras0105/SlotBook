import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import RequireAuth from './auth/RequireAuth';
import RequireRole from './auth/RequireRole';
import Layout from './components/Layout';
import AdminAppointmentsPage from './pages/AdminAppointmentsPage';
import AdminOverviewPage from './pages/AdminOverviewPage';
import AppointmentsPage from './pages/AppointmentsPage';
import BecomeProviderPage from './pages/BecomeProviderPage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import ProviderDashboardPage from './pages/ProviderDashboardPage';
import ProviderPage from './pages/ProviderPage';
import ProvidersPage from './pages/ProvidersPage';
import RegisterPage from './pages/RegisterPage';
import ReschedulePage from './pages/ReschedulePage';

// Start every new page at the top (only when the path changes, not when ?date= or ?q= does).
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Braces matter: modern Chrome's scrollTo() returns a Promise, and an effect that RETURNS
    // something makes React try to call it as a cleanup function and crash the whole app.
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/providers" replace />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/providers/:id" element={<ProviderPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/appointments" element={<RequireAuth><AppointmentsPage /></RequireAuth>} />
          <Route path="/appointments/:id/reschedule" element={<RequireAuth><ReschedulePage /></RequireAuth>} />
          <Route path="/become-provider" element={<BecomeProviderPage />} />
          <Route path="/dashboard" element={<RequireRole roles={['provider']}><ProviderDashboardPage /></RequireRole>} />
          <Route path="/admin" element={<RequireRole roles={['admin']}><AdminOverviewPage /></RequireRole>} />
          <Route path="/admin/appointments" element={<RequireRole roles={['admin']}><AdminAppointmentsPage /></RequireRole>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
