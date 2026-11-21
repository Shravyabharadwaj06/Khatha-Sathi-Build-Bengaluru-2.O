import { useEffect, useLayoutEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Home from './pages/Home';
import Legal from './pages/Legal';
import { ProtectedRoute } from './components/ProtectedRoute';
import { logout } from './services/api';
import { clearSession, getSession } from './services/session';

/** New route -> start at the top (unless navigating to a #section). */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useLayoutEffect(() => {
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash]);
  return null;
}

/** /logout: clears the session (and tells the API), then goes to /login. No UI of its own. */
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

/** Already logged in -> skip the auth screens. */
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
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/logout" element={<Logout />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
