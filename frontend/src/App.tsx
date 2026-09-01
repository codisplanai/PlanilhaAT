import { lazy, Suspense, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { LoadingSpinner } from './components/feedback/LoadingSpinner';
import { Layout } from './components/layout/Layout';
import { AdminRoute } from './components/auth/AdminRoute';
import { useAuthSession } from './hooks/useAuthSession';

const LoginPage = lazy(() =>
  import('./pages/Login').then(({ LoginPage: page }) => ({ default: page }))
);
const DashboardPage = lazy(() =>
  import('./pages/Dashboard').then(({ DashboardPage: page }) => ({ default: page }))
);
const EmpresasPage = lazy(() =>
  import('./pages/Empresas').then(({ EmpresasPage: page }) => ({ default: page }))
);
const PerfisRegrasPage = lazy(() =>
  import('./pages/PerfisRegras').then(({ PerfisRegrasPage: page }) => ({ default: page }))
);
const NovaSolicitacaoPage = lazy(() =>
  import('./pages/NovaSolicitacao').then(({ NovaSolicitacaoPage: page }) => ({ default: page }))
);
const HistoricoPage = lazy(() =>
  import('./pages/Historico').then(({ HistoricoPage: page }) => ({ default: page }))
);
const AdminTemplatesPage = lazy(() =>
  import('./pages/AdminTemplates').then(({ AdminTemplatesPage: page }) => ({ default: page }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export function App() {
  const { user, isInitializing, startSession, endSession } = useAuthSession();

  useEffect(() => {
    if (!user) queryClient.clear();
  }, [user]);

  const handleLogout = async () => {
    queryClient.clear();
    await endSession();
  };

  if (isInitializing) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-900">
        <LoadingSpinner message="Inicializando sistema..." />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<LoadingSpinner message="Carregando página..." />}>
          <Routes>
            <Route
              path="/login"
              element={
                user ? (
                  <Navigate to="/" replace />
                ) : (
                  <LoginPage onAuthenticated={startSession} />
                )
              }
            />

            <Route
              element={
                user ? (
                  <Layout user={user} onLogout={handleLogout} />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/empresas" element={<EmpresasPage />} />
              <Route path="/perfis-regras" element={<PerfisRegrasPage />} />
              <Route path="/nova-solicitacao" element={<NovaSolicitacaoPage />} />
              <Route path="/solicitacoes" element={<HistoricoPage />} />
              <Route
                path="/templates"
                element={
                  <AdminRoute user={user}>
                    <AdminTemplatesPage />
                  </AdminRoute>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
