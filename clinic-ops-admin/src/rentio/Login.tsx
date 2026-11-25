/**
 * Rentio local demo sign-in. NOT authentication: no password, simulated roles, fictional people.
 * One dropdown lists every demo user grouped by role; Sign In signs in as that person and lands on their
 * role landing (owner overview for roles with `ct.view`, otherwise My work) — or on the protected
 * page they came from (`?next=`) when that person may open it. Shows no business figures.
 */
import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/primitives/Icon';
import { routeAllowed } from '../components/shell/AppShell';
import { demoUsers, domain, organization, workspaces } from '../domain/active';
import { wsBase } from '../lib/routes';
import { actorFor, can } from '../services/authz';
import { getDb } from '../services/db';
import { useRevision } from '../services/hooks';
import { getRole } from '../services/registry';
import { isSignedIn, signIn } from '../services/settings';

/** Role landing: owner overview for roles that may see it, otherwise My work (staff landing). */
export function roleLanding(userId: string, workspaceId: string) {
  return can(actorFor(userId, workspaceId), 'ct.view') ? `${wsBase(workspaceId)}/dashboard` : `${wsBase(workspaceId)}/home/my-work`;
}

/** Where to go after signing in: the requested page when this user may open it, else the role landing. */
export function afterSignIn(userId: string, workspaceId: string, next: string | null) {
  const landing = roleLanding(userId, workspaceId);
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login') || next === '/') return landing;
  const pathname = next.split(/[?#]/)[0];
  const personal = pathname.match(/^\/u\/([^/]+)\/my-work/);
  if (personal) return personal[1] === userId ? next : landing;
  const ws = pathname.split('/')[4];
  const wsId = workspaces().find((w) => w.slug === ws || w.id === ws)?.id ?? workspaceId;
  return routeAllowed(actorFor(userId, wsId), pathname) ? next : landing;
}

export default function RentioLogin() {
  useRevision();
  const location = useLocation();
  const navigate = useNavigate();
  const next = new URLSearchParams(location.search).get('next');
  const [userId, setUserId] = useState('');

  // light-first: the sign-in screen never follows the OS dark mode (no user is chosen yet);
  // its own tab title replaces index.html's boilerplate and any ERP page title kept after logout
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.title = `Sign in · ${domain().productName}`;
  }, []);

  if (isSignedIn()) {
    const { userId, workspaceId } = getDb().session;
    return <Navigate to={afterSignIn(userId, workspaceId, next)} replace />;
  }

  const workspaceId = getDb().session.workspaceId || workspaces()[0].id;
  const roleOrder = [...new Set(demoUsers().map((u) => u.roleId))];
  const groups = roleOrder.map((r) => ({ roleId: r, label: getRole(r).label, users: demoUsers().filter((u) => u.roleId === r) }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    signIn(userId, workspaceId);
    navigate(afterSignIn(userId, workspaceId, next), { replace: true });
  };

  return (
    <div className="rt-login">
      {/* the artwork carries the brand line ("Rentio Foods — Rooted in Swadeshi. Since 1935.") */}
      <div className="rt-login-art" role="img" aria-label={`${organization().name.replace(/\s*\(.*\)$/, '')} — rooted in Swadeshi, since 1935: a pulses factory, field and charkha`} />
      <main className="rt-login-card" aria-labelledby="rt-login-title">
        <span className="rt-login-eyebrow">Rentio Smart ERP</span>
        <h1 id="rt-login-title" className="rt-login-title">
          Sign In
        </h1>
        <span className="rt-login-rule" aria-hidden="true" />
        <p className="rt-login-sub">Choose who you want to work as to continue.</p>
        {next && next !== '/' && <p className="muted small">Sign in to continue to the page you opened. If the person you choose may not open it, you land on their usual start page.</p>}
        <form className="rt-login-form" onSubmit={submit}>
          <label className="rt-login-label" htmlFor="rt-login-user">
            User and role
          </label>
          <div className="rt-login-field">
            <Icon name="f-person" size={16} />
            <select id="rt-login-user" className="rt-login-select" value={userId} onChange={(e) => setUserId(e.target.value)} autoFocus>
              <option value="" disabled>
                Select a user
              </option>
              {groups.map((g) => (
                <optgroup key={g.roleId} label={g.label}>
                  {g.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.title ?? g.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Icon name="chevron-down" size={16} />
          </div>
          <button type="submit" className="rt-login-submit" disabled={!userId}>
            Sign In
          </button>
        </form>
        <p className="rt-login-note" role="note">
          <Icon name="info" size={14} />
          <span>
            <strong>Local demo sign-in — no password, simulated roles, fictional data.</strong> This is not real authentication; your data stays in this browser.
          </span>
        </p>
      </main>
    </div>
  );
}
