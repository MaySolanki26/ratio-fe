/**
 * Rentio local demo sign-in. NOT authentication: no password, simulated roles, fictional people.
 * Lists every demo user grouped by role; choosing one signs in as that person and lands on their
 * role landing (owner overview for roles with `ct.view`, otherwise My work) — or on the protected
 * page they came from (`?next=`) when that person may open it. Shows no business figures.
 */
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/primitives/Icon';
import { Avatar } from '../components/primitives/feedback';
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
  const [q, setQ] = useState('');

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
  const needle = q.trim().toLowerCase();
  const users = demoUsers().filter((u) => !needle || [u.name, u.title ?? '', getRole(u.roleId).label].some((t) => t.toLowerCase().includes(needle)));
  const roleOrder = [...new Set(demoUsers().map((u) => u.roleId))];
  const groups = roleOrder.map((r) => ({ roleId: r, label: getRole(r).label, users: users.filter((u) => u.roleId === r) })).filter((g) => g.users.length);

  const choose = (userId: string) => {
    signIn(userId, workspaceId);
    navigate(afterSignIn(userId, workspaceId, next), { replace: true });
  };

  return (
    <div className="rt-login">
      <main className="rt-login-card" aria-labelledby="rt-login-title">
        <div className="rt-login-brand" aria-hidden="true">
          RT
        </div>
        <h1 id="rt-login-title" className="rt-login-title">
          Sign in to {organization().name}
        </h1>
        <p className="rt-login-note" role="note">
          <Icon name="info" size={14} />
          <span>
            <strong>Local demo sign-in — no password, simulated roles, fictional data.</strong> Pick the person you want to work as. This is not real authentication; your data stays in this browser.
          </span>
        </p>
        {next && next !== '/' && <p className="muted small">Sign in to continue to the page you opened. If the person you choose may not open it, you land on their usual start page.</p>}
        <div className="rt-login-search">
          <Icon name="search" size={14} />
          <input type="search" className="input" placeholder="Search by name or role" aria-label="Search demo users" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus autoFocus />
        </div>
        {groups.length ? (
          <div className="rt-login-groups">
            {groups.map((g) => (
              <section key={g.roleId} className="rt-login-group" aria-label={g.label}>
                <h2 className="rt-login-role">{g.label}</h2>
                <ul className="rt-login-list">
                  {g.users.map((u) => (
                    <li key={u.id}>
                      <button type="button" className="rt-login-user" onClick={() => choose(u.id)} aria-label={`Sign in as ${u.name}, ${g.label}`}>
                        <Avatar name={u.name} size={30} />
                        <span className="rt-login-user-text">
                          <span className="rt-login-user-name">{u.name}</span>
                          <span className="muted small">{u.title ?? g.label}</span>
                        </span>
                        <Icon name="chevron-right" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="muted rt-login-empty">No demo user matches “{q}”.</p>
        )}
      </main>
    </div>
  );
}
