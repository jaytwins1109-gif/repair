import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Case } from './api/types';
import { CaseDrawer } from './components/CaseDrawer';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { UploadCaseModal } from './components/UploadCaseModal';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { CaseFiltersProvider, useCaseFilters } from './hooks/useCaseFilters';
import { SessionsProvider } from './hooks/useSessions';
import { ToastProvider } from './hooks/useToast';
import { NAV_ITEMS, type PageKey } from './navigation';
import { LoginPage } from './pages/LoginPage';
import { CasesPage } from './pages/CasesPage';
import { ChatPage } from './pages/ChatPage';
import { CustomersPage } from './pages/CustomersPage';
import { ModelsPage } from './pages/ModelsPage';
import { ModelsAdminPage } from './pages/ModelsAdminPage';
import { PendingPage } from './pages/PendingPage';
import { SettingsPage } from './pages/SettingsPage';

function AppShell() {
  const [page, setPage] = useState<PageKey>('chat');
  const [search, setSearch] = useState('');
  const { setFilter } = useCaseFilters();
  const [drawerCase, setDrawerCase] = useState<Case | null>(null);
  const [drawerEditing, setDrawerEditing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    api
      .listCases({ status: 'pending', pageSize: 1 })
      .then((res) => setPendingCount(res.total))
      .catch(() => undefined);
  }, [version]);

  const handleChanged = useCallback(() => setVersion((v) => v + 1), []);
  const openCase = useCallback((item: Case) => {
    setDrawerEditing(false);
    setDrawerCase(item);
  }, []);
  const editCase = useCallback((item: Case) => {
    setDrawerEditing(true);
    setDrawerCase(item);
  }, []);
  const closeDrawer = useCallback(() => setDrawerCase(null), []);
  const openUpload = useCallback(() => setUploadOpen(true), []);
  const closeUpload = useCallback(() => setUploadOpen(false), []);

  const submitSearch = useCallback(() => {
    if (!search.trim()) return;
    setFilter('q', search.trim());
    setPage('cases');
  }, [search, setFilter]);

  const current = NAV_ITEMS.find((item) => item.key === page) || NAV_ITEMS[0];

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar current={page} onNavigate={setPage} pendingCount={pendingCount} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          title={current.label}
          subtitle={current.subtitle}
          search={search}
          onSearchChange={setSearch}
          onSearchSubmit={submitSearch}
          onUpload={openUpload}
        />

        <main className="min-h-0 flex-1 overflow-hidden">
          {page === 'chat' && <ChatPage onOpenCase={openCase} />}
          {page === 'cases' && (
            <CasesPage
              onOpenCase={openCase}
              onEditCase={editCase}
              onChanged={handleChanged}
              onUpload={openUpload}
            />
          )}
          {page === 'models' && <ModelsPage version={version} />}
          {page === 'customers' && <CustomersPage version={version} />}
          {page === 'pending' && (
            <PendingPage onChanged={handleChanged} onOpenCase={openCase} onEditCase={editCase} />
          )}
          {page === 'model-admin' && <ModelsAdminPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>

      <CaseDrawer
        item={drawerCase}
        initialEditing={drawerEditing}
        onClose={closeDrawer}
        onChanged={handleChanged}
        onOpenCase={openCase}
      />
      <UploadCaseModal
        open={uploadOpen}
        onClose={closeUpload}
        onSuccess={() => {
          handleChanged();
          setPage('pending');
        }}
      />
    </div>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid h-screen w-full place-items-center bg-graphite">
        <div className="font-mono text-[11px] tracking-[.2em] text-accent">
          正在恢复登录状态…
        </div>
      </div>
    );
  }

  return user ? (
    <SessionsProvider>
      <CaseFiltersProvider>
        <AppShell />
      </CaseFiltersProvider>
    </SessionsProvider>
  ) : (
    <LoginPage />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AuthGate />
      </ToastProvider>
    </AuthProvider>
  );
}
