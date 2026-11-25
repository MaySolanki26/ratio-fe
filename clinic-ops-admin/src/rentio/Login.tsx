/**
 * Rentio local demo sign-in. NOT authentication: no password, simulated roles, fictional people.
 * One custom dropdown (no native <select>) lists every demo user grouped by role; Sign In signs in as that person and lands on their
 * role landing (owner overview for roles with `ct.view`, otherwise My work) — or on the protected
 * page they came from (`?next=`) when that person may open it. Shows no business figures.
 */
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
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
          <label className="rt-login-label" id="rt-login-user-label" htmlFor="rt-login-user">
            User and role
          </label>
          <UserPicker groups={groups} value={userId} onChange={setUserId} />
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

type UserGroup = { roleId: string; label: string; users: { id: string; name: string; title?: string }[] };

/**
 * Login-only custom dropdown: a trigger button + a role-grouped listbox that opens inline below the field.
 * Keyboard: ↑/↓/Enter/Space open; ↑/↓/Home/End move; Enter/Space choose; Esc closes; typing jumps by name.
 */
function UserPicker({ groups, value, onChange }: { groups: UserGroup[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const flat = groups.flatMap((g) => g.users.map((u) => ({ ...u, sub: u.title ?? g.label })));
  const current = flat.find((u) => u.id === value);

  useEffect(() => {
    trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    list.current?.focus();
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    setActive(Math.max(0, flat.findIndex((u) => u.id === value)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (id: string | undefined) => {
    if (!id) return;
    onChange(id);
    close();
  };
  const onListKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((a) => Math.min(flat.length - 1, a + 1)),
      ArrowUp: () => setActive((a) => Math.max(0, a - 1)),
      Home: () => setActive(0),
      End: () => setActive(flat.length - 1),
      Enter: () => choose(flat[active]?.id),
      ' ': () => choose(flat[active]?.id),
      Escape: close,
    };
    if (keys[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      keys[e.key]();
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const from = active + 1;
      const order = [...flat.slice(from), ...flat.slice(0, from)];
      const hit = order.find((u) => u.name.toLowerCase().startsWith(k));
      if (hit) setActive(flat.indexOf(hit));
    }
  };

  let index = -1;
  return (
    <div className="rt-login-field" ref={wrap}>
      <button
        ref={trigger}
        id="rt-login-user"
        type="button"
        className={`rt-login-select${open ? ' is-open' : ''}${current ? '' : ' is-placeholder'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby="rt-login-user-label rt-login-user-value"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openList();
          }
        }}
      >
        <Icon name="f-person" size={16} />
        <span className="rt-login-select-value" id="rt-login-user-value">{current ? `${current.name} · ${current.sub}` : 'Select a user'}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <ul ref={list} id={listId} role="listbox" aria-label="User and role" tabIndex={-1} className="rt-login-menu" aria-activedescendant={`${listId}-${active}`} onKeyDown={onListKey}>
          {groups.map((g) => (
            <li key={g.roleId} role="presentation">
              <div className="rt-login-menu-group" id={`${listId}-g-${g.roleId}`}>
                {g.label}
              </div>
              <ul role="group" aria-labelledby={`${listId}-g-${g.roleId}`} className="rt-login-menu-items">
                {g.users.map((u) => {
                  const i = ++index;
                  const selected = u.id === value;
                  return (
                    <li
                      key={u.id}
                      id={`${listId}-${i}`}
                      data-index={i}
                      data-value={u.id}
                      role="option"
                      aria-selected={selected}
                      className={`rt-login-option${i === active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(u.id)}
                    >
                      <span className="rt-login-option-text">
                        <span className="rt-login-option-name">{u.name}</span>
                        <span className="rt-login-option-sub"> · {u.title ?? g.label}</span>
                      </span>
                      {selected && <Icon name="check" size={14} />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
