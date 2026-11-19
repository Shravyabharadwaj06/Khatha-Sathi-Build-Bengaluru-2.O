import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getSession } from '../services/session';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!getSession()) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
