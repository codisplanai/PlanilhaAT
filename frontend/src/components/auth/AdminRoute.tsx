import React from 'react';
import { Navigate } from 'react-router-dom';
import { isAdminOrSenior } from '../../lib/permissions';
import type { User } from '../../types/auth';

interface AdminRouteProps {
  user: User | null;
  children: React.ReactNode;
  /** Libera também o Contador Sênior, como o ``require_admin`` da API. */
  allowSenior?: boolean;
}

export const AdminRoute: React.FC<AdminRouteProps> = ({ user, children, allowSenior = false }) => {
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const allowed = allowSenior ? isAdminOrSenior(user) : user.role === 'admin';

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
