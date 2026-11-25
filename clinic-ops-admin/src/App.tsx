import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { wsBase } from './lib/routes';
import { getDb } from './services/db';
import { useActor, useRevision } from './services/hooks';
import { getWorkspace } from './services/registry';
import { isSignedIn, switchSession, usesLoginGate } from './services/settings';
import { domain, organization } from './domain/active';
import { AppShell } from './components/shell/AppShell';
import { ErrorState, NoAccess, ToastProvider } from './components/primitives/feedback';
import { can } from './services/authz';
import RentioLogin, { roleLanding } from './rentio/Login';
import { TooltipLayer } from './components/primitives/TooltipLayer';
import { ConfirmHost } from './components/primitives/overlay';
import { DashboardPage } from './pages/DashboardPage';
import { RecordPage, ResourcePage } from './pages/ResourcePage';
import { FullPageFormPage, InboxPage, MyWorkRedirect, SchedulePage } from './pages/WorkPages';
import { AccessPage, AuditPage, EventsPage, SettingsPage, StudioPage } from './pages/AdminPages';
import { RolePage } from './pages/RolesPage';
import { RENTIO_PAGES, RentioDashboard } from './rentio/pages';

function NotFound({ message }: { message?: string }) {
  const actor = useActor();
  return (
    <div className="page">
      <ErrorState title="Page not found">{message ?? 'This link is invalid, was renamed, or points to something you cannot access.'}</ErrorState>
      <p className="center">
        <Link to={`${wsBase(actor.workspaceId)}/dashboard`}>Go to overview</Link>
      </p>
    </div>
  );
}

/** Resolves org/workspace slugs to known IDs; unknown slugs never fall through to another workspace. */
function WorkspaceGate() {
  const { org, ws } = useParams();
  const workspace = ws ? getWorkspace(ws) : undefined;
  const valid = org === organization().slug && !!workspace;
  const session = getDb().session;
  useEffect(() => {
    if (valid && workspace && session.workspaceId !== workspace.id) switchSession(session.userId, workspace.id);
  }, [valid, workspace, session.workspaceId, session.userId]);
  if (!valid) {
    return (
      <AppShell>
        <NotFound message="This organization or workspace does not exist, or you are not a member." />
      </AppShell>
    );
  }
  if (session.workspaceId !== workspace!.id) return null;
  return (
    <AppShell>
      <Routes>
        <Route path="dashboard" element={domain().id === 'rentio' ? <RentioDashboard /> : <DashboardPage />} />
        <Route path="scheduling/schedule" element={<SchedulePage />} />
        <Route path="work/inbox" element={<LegacyInbox />} />
        <Route path="admin/studio" element={<StudioPage />} />
        <Route path="admin/access" element={<AccessPage />} />
        <Route path="admin/access/roles/:roleId" element={<RolePage />} />
        <Route path="admin/audit" element={<AuditPage />} />
        <Route path="admin/events" element={<EventsPage />} />
        <Route path="admin/settings" element={<SettingsPage />} />
        <Route path=":module/:resource" element={<ResourceRoute kind="list" />} />
        <Route path=":module/:resource/new" element={<ResourceRoute kind="new" />} />
        <Route path=":module/:resource/:recordId/edit" element={<ResourceRoute kind="edit" />} />
        <Route path=":module/:resource/:recordId" element={<ResourceRoute kind="record" />} />
        <Route path="" element={<Navigate to="dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

function ResourceRoute({ kind }: { kind: 'list' | 'new' | 'edit' | 'record' }) {
  const { module, resource } = useParams();
  const actor = useActor();
  const Page = domain().id === 'rentio' && kind === 'list' ? RENTIO_PAGES[`${module}/${resource}`] : undefined;
  if (Page) {
    // Route guard: direct URLs obey the same explicit page allow-list as the navigation (read protection).
    if (!can(actor, `page:${module}/${resource}`))
      return (
        <div className="page">
          <NoAccess what="this page" />
          <p className="center">
            <Link to={`${wsBase(actor.workspaceId)}/home/my-work`}>Go to My work</Link>
          </p>
        </div>
      );
    return <Page key={`${module}/${resource}`} />;
  }
  const res = domain().pack.resources.find((r) => r.key === resource);
  if (!res || res.module !== module) return <NotFound />;
  if (kind === 'list') return <ResourcePage key={res.key} />;
  if (kind === 'record') return <RecordPage key={res.key} />;
  return <FullPageFormPage key={`${res.key}-${kind}`} />;
}

function RootRedirect() {
  const { workspaceId, userId } = getDb().session;
  // Rentio: staff land on My work; the owner overview is for roles that can see it
  if (domain().id === 'rentio') return <Navigate to={roleLanding(userId, workspaceId)} replace />;
  return <Navigate to={`${wsBase(workspaceId)}/dashboard`} replace />;
}

/** Old Work-inbox bookmarks: Rentio's inbox is Home › Inbox; the clinic keeps its own Work inbox page. */
function LegacyInbox() {
  const { ws } = useParams();
  const { search } = useLocation();
  if (domain().id === 'rentio') return <Navigate to={`${wsBase(ws ?? getDb().session.workspaceId)}/home/inbox${search}`} replace />;
  return <InboxPage />;
}

/**
 * Rentio demo login gate: signed out (or a fresh browser) → the login screen, remembering the
 * requested URL. Back / refresh after logout land here again because the signed-out marker is
 * persisted. The clinic pack keeps its automatic session (isSignedIn() is always true there).
 */
function RequireSignIn({ children }: { children: ReactNode }) {
  useRevision();
  const location = useLocation();
  const [, setTick] = useState(0);
  // another tab signing in/out changes only the marker key — re-check the gate
  useEffect(() => {
    const on = (e: StorageEvent) => e.key?.endsWith('.signin') && setTick((t) => t + 1);
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  if (!isSignedIn()) {
    const here = location.pathname + location.search;
    return <Navigate to={here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <TooltipLayer />
      <ConfirmHost />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={usesLoginGate() ? <RentioLogin /> : <RootRedirect />} />
          <Route
            path="/"
            element={
              <RequireSignIn>
                <RootRedirect />
              </RequireSignIn>
            }
          />
          <Route
            path="/u/:userSlug/my-work"
            element={
              <RequireSignIn>
                <AppShell>
                  <MyWorkRedirect />
                </AppShell>
              </RequireSignIn>
            }
          />
          <Route
            path="/o/:org/w/:ws/*"
            element={
              <RequireSignIn>
                <WorkspaceGate />
              </RequireSignIn>
            }
          />
          <Route
            path="*"
            element={
              <RequireSignIn>
                <RootRedirect />
              </RequireSignIn>
            }
          />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
