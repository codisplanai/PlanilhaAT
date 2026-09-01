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

  const isAdmin = user.role === 'admin';

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
