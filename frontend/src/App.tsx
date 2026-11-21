import { useEffect, useLayoutEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Home from './pages/Home';
import Profile from './pages/Profile';
import Legal from './pages/Legal';
import ReportIssue from './pages/ReportIssue';
import ReportSent from './pages/ReportSent';
import MyReports from './pages/MyReports';
import Products from './pages/Products';
import Customers from './pages/Customers';
import Assistant from './pages/Assistant';
import { ProtectedRoute } from './components/ProtectedRoute';
import { logout } from './services/api';
import { clearSession, getSession } from './services/session';

function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useLayoutEffect(() => {
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash]);

  return null;
}

function Logout() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const done = () => {
      clearSession();
      if (!cancelled) navigate('/login', { replace: true });
    };

    logout().then(done, done);

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return null;
}

function GuestOnly({ children }: { children: JSX.Element }) {
  return getSession() ? <Navigate to="/home" replace /> : children;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
        <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />

        <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/report-issue" element={<ProtectedRoute><ReportIssue /></ProtectedRoute>} />
        <Route path="/report-sent" element={<ProtectedRoute><ReportSent /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><MyReports /></ProtectedRoute>} />
        <Route path="/assistant" element={<ProtectedRoute><Assistant /></ProtectedRoute>} />

        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/logout" element={<Logout />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
