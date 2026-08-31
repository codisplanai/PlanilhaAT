import React from 'react';
import { Navigate } from 'react-router-dom';
import type { User } from '../../types/auth';

interface AdminRouteProps {
  user: User | null;
  children: React.ReactNode;
}

export const AdminRoute: React.FC<AdminRouteProps> = ({ user, children }) => {
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isAdmin =
    user.role === 'admin'
    || user.cargo?.toLowerCase().includes('contador sênior')
    || user.cargo?.toLowerCase().includes('contador senior')
    || user.cargo?.toLowerCase().includes('admin');

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
