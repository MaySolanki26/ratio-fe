import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { demoUsers, domain, modules, organization, workspaces } from '../../domain/active';
import { cx } from '../../lib/format';
import { pagePath, recordPeekPath, resourcePath, wsBase } from '../../lib/routes';
import { PHONE, TABLET, useMedia } from '../../lib/useMedia';
import { actorFor, can, canReadResource } from '../../services/authz';
import { listNotifications, markAllRead, markNotification, snoozeNotification } from '../../services/collab';
import { getDb, getPersistError, resetDb } from '../../services/db';
import { useActor, useRevision } from '../../services/hooks';
import { getResource, getRole } from '../../services/registry';
import { searchRecords } from '../../services/search';
import { getSettings, SIDEBAR_MAX, SIDEBAR_MIN, signOut, switchSession, toggleFavorite, togglePin, updateSettings, usesLoginGate } from '../../services/settings';
import { ractor } from '../../domain/rentio/access';
import { inboxUnread } from '../../rentio/inbox';
import { defaultViewId, listViews } from '../../services/views';
import { relativeTime } from '../../lib/dates';
import { applyPalette, findPalette, type Palette } from '../../lib/palette';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Avatar, useToast } from '../primitives/feedback';
import { Dialog, Drawer, EXIT_MS, motionOK, Popover, useLayer } from '../primitives/overlay';
import { HelpContent } from './help';
import { InfoTip } from '../primitives/InfoTip';
import { TOPBAR_TITLE_SLOT } from './PageHeader';
import { TYPE_ICON } from '../resource/ViewControls';
import { PaletteEditor, ThemePicker } from './ThemePicker';
import { pageZoom } from '../../lib/zoom';

function moduleVisible(actor: ReturnType<typeof useActor>, m: ReturnType<typeof modules>[number]) {
  if (m.resources.some((r) => canReadResource(actor, r))) return true;
  return (m.pages ?? []).some((p) => !p.capability || can(actor, p.capability));
}

/** Can this actor open the page at `pathname` (same rules as navigation and the route guard)? */
export function routeAllowed(actor: ReturnType<typeof useActor>, pathname: string) {
  const parts = pathname.split('/');
  const seg = parts[5];
  const sub = parts[6];
  if (!seg) return true;
  if (seg === 'dashboard') {
    const p = modules().find((m) => m.id === 'home')?.pages?.find((x) => x.path === 'dashboard');
    return !p?.capability || can(actor, p.capability);
  }
  const m = modules().find((x) => x.id === seg);
  if (!m || !sub) return true;
  const page = m.pages?.find((x) => x.path === sub);
  if (page) return !page.capability || can(actor, page.capability);
  if (m.resources.includes(sub)) return canReadResource(actor, sub);
  return true;
}

/**
 * Where a module shortcut (rail, mobile nav) lands for THIS actor: the first page or resource the role may
 * open, in sidebar order. A module whose default page is forbidden never links to it (direct visits to that
 * URL are still refused by the route guard).
 */
export function moduleLanding(actor: ReturnType<typeof useActor>, m: ReturnType<typeof modules>[number]) {
  const ws = actor.workspaceId;
  const pages = (m.pages ?? []).filter((p) => (!p.capability || can(actor, p.capability)) && (!p.resource || canReadResource(actor, p.resource)));
  if (m.id === 'home') return pages[0] ? pagePath(ws, m.id, pages[0].path) : `${wsBase(ws)}/dashboard`;
  const res = m.resources.find((r) => canReadResource(actor, r));
  if (res) return resourcePath(ws, res);
  if (pages[0]) return pagePath(ws, m.id, pages[0].path);
  return domain().id === 'rentio' ? `${wsBase(ws)}/home/my-work` : `${wsBase(ws)}/dashboard`;
}

/** Personal inbox: Rentio's Home › Inbox; the clinic pack keeps its Work inbox. (My work stays the staff landing.) */
const inboxPath = (ws: string) => (domain().id === 'rentio' ? `${wsBase(ws)}/home/inbox` : pagePath(ws, 'work', 'inbox'));
const inboxLabel = () => (domain().id === 'rentio' ? 'Inbox' : 'Work inbox');
const isInboxPath = (pathname: string) => (domain().id === 'rentio' ? pathname.endsWith('/home/inbox') : pathname.endsWith('/work/inbox'));

/** Unread items in the signed-in person's inbox (Rentio: scoped work + alerts; clinic: notifications). */
function inboxUnreadCount(actor: ReturnType<typeof useActor>) {
  if (domain().id !== 'rentio') return listNotifications(actor).filter((n) => !n.readAt).length;
  return inboxUnread(getDb(), ractor(actor.user.id), new Date().toISOString());
}

function activeModule(pathname: string) {
  const parts = pathname.split('/');
  // /o/:org/w/:ws/:module/...
  const seg = parts[5];
  if (!seg || seg === 'dashboard') return 'home';
  return seg;
}

export function AppShell({ children }: { children: ReactNode }) {
  useRevision();
  const actor = useActor();
  const settings = getSettings(actor.user.id);
  const location = useLocation();
  const phone = useMedia(PHONE);
  const tablet = useMedia(TABLET);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const mod = activeModule(location.pathname);
  const drawerNav = tablet;

  useEffect(() => setNavOpen(false), [location.pathname]);

  // Theme + rail skin are personal settings.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  // Colour theme (palette): the selected preset or the user's own palette.
  const palette = findPalette(settings.palette, settings.customPalettes);
  useEffect(() => applyPalette(palette), [palette.id, palette.accent, palette.sidebar, palette.rail, palette.canvas]); // eslint-disable-line react-hooks/exhaustive-deps
  // Display size (Feature preferences): zoom on <html>; 100% = no zoom
  const zoom = settings.zoom ?? 100;
  useEffect(() => {
    document.documentElement.style.zoom = zoom === 100 ? '' : String(zoom / 100);
  }, [zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const persistError = getPersistError();

  return (
    // Every page sits on the soft canvas colour with white surfaces on top (owner, 2026-11-24: option B)
    <div className={cx('app', settings.navDensity === 'compact' && 'nav-compact')} data-rail-skin="palette" data-canvas="all">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="preview-banner" role="note">
        <Icon name="info" size={14} />
        <span>
          <strong>Prototype</strong> · {domain().bannerShort ?? domain().banner}
        </span>
        <button type="button" className="link" onClick={() => setHelpOpen(true)}>
          What is real?
        </button>
      </div>
      {persistError && (
        <div className="preview-banner tone-danger" role="alert">
          Local storage is unavailable ({persistError}). Changes will be lost on reload.
        </div>
      )}
      <div className="shell">
        {!phone && <IconRail mod={mod} onHelp={() => setHelpOpen(true)} />}
        {/* Always mounted so collapse / expand can animate smoothly (width slides to 0) */}
        {!drawerNav && <ContextSidebar mod={mod} collapsed={settings.sidebarCollapsed} />}
        {drawerNav && navOpen && <MobileNav mod={mod} onClose={() => setNavOpen(false)} onSearch={() => setPaletteOpen(true)} onHelp={() => setHelpOpen(true)} showRail={phone} />}
        <div className="workspace">
          <TopBar onMenu={() => setNavOpen(true)} showMenu={drawerNav || settings.sidebarCollapsed} onSearch={() => setPaletteOpen(true)} />
          <main id="main" className="canvas" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Drawer open={helpOpen} onClose={() => setHelpOpen(false)} title="Help & prototype boundaries">
        <HelpContent mod={mod} />
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------- Icon rail

function IconRail({ mod, onHelp }: { mod: string; onHelp: () => void }) {
  const actor = useActor();
  const unread = inboxUnreadCount(actor);
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <nav className="rail" aria-label="Modules">
      <Link to={`${wsBase(actor.workspaceId)}/dashboard`} className="rail-brand" aria-label={`${organization().name} home`} data-tooltip={organization().name}>
        <span aria-hidden="true">{domain().id === 'rentio' ? 'RT' : 'NW'}</span>
      </Link>
      <ul className="rail-list">
        {modules()
          .filter((m) => m.id !== 'admin' && moduleVisible(actor, m))
          .map((m, i) => (
            <li key={m.id} style={{ order: i < 2 ? i : i + 1 }}>
              <Link
                to={moduleLanding(actor, m)}
                className={cx('rail-item', mod === m.id && 'is-active')}
                aria-current={mod === m.id ? 'page' : undefined}
                aria-label={m.label}
                data-tooltip={m.label}
              >
                <Icon name={m.icon} />
              </Link>
            </li>
          ))}
        {/* Work inbox: 3rd item in the rail, after Home and Scheduling (owner rule 69) */}
        <li style={{ order: 2 }}>
          <button type="button" className={cx('rail-item', isInboxPath(location.pathname) && 'is-active')} aria-current={isInboxPath(location.pathname) ? 'page' : undefined} aria-label={`${inboxLabel()}${unread ? `, ${unread} unread` : ''}`} data-tooltip={inboxLabel()} onClick={() => navigate(inboxPath(actor.workspaceId))}>
            <Icon name="inbox" />
            {/* no count badge on the icon rail (owner, 2026-11-24); the unread count stays in the label */}
          </button>
        </li>
      </ul>
      <ul className="rail-list rail-bottom">
        <li>
          <button type="button" className="rail-item" aria-label="AI assistant (not available)" data-tooltip="AI assistant — not enabled in this prototype" aria-disabled="true" onClick={onHelp}>
            <Icon name="sparkles" />
          </button>
        </li>
        <li>
          <Link to={pagePath(actor.workspaceId, 'admin', 'settings')} className={cx('rail-item', mod === 'admin' && 'is-active')} aria-label="Administration and settings" data-tooltip="Administration">
            <Icon name="settings" />
          </Link>
        </li>
        {/* Theme & colours and the user's profile live at the bottom of the rail (owner rule) */}
        <li>
          <ThemeButton inRail />
        </li>
        <li>
          <AccountMenu inRail />
        </li>
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------- Context sidebar

type NavEntry = { key: string; label: string; path: string; icon?: string; active: boolean; /** icon used in Favorites / Results when the row itself is text-only */ altIcon?: string };

/** Star beside a sidebar option: hidden until hover/focus; filled (accent) once it is a favourite. */
function FavStar({ entry }: { entry: NavEntry }) {
  const actor = useActor();
  const fav = getSettings(actor.user.id).favorites.some((f) => f.path === entry.path);
  return (
    <button
      type="button"
      className={cx('nav-star', fav && 'is-on')}
      aria-pressed={fav}
      aria-label={fav ? `Remove ${entry.label} from favorites` : `Add ${entry.label} to favorites`}
      data-tooltip={fav ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(actor, { label: entry.label, path: entry.path, icon: entry.icon ?? entry.altIcon });
      }}
    >
      <Icon name="star" size={14} />
    </button>
  );
}

function NavItem({ entry, star = true }: { entry: NavEntry; star?: boolean }) {
  return (
    <li className="nav-item">
      <Link to={entry.path} className={cx('nav-row', !entry.icon && 'nav-child', entry.active && 'is-active')} aria-current={entry.active ? 'page' : undefined}>
        {entry.icon && <Icon name={entry.icon} />}
        <span className="nav-label">{entry.label}</span>
      </Link>
      {star && <FavStar entry={entry} />}
    </li>
  );
}

function SidebarContent({ mod, headerAction }: { mod: string; headerAction?: ReactNode }) {
  const actor = useActor();
  const settings = getSettings(actor.user.id);
  const location = useLocation();
  const m = modules().find((x) => x.id === mod) ?? modules()[0];
  const here = location.pathname + location.search;
  const [q, setQ] = useState('');
  const [collapsedGroups, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => {
    const n = new Set(collapsedGroups);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setCollapsed(n);
  };

  // Everything the sidebar can open, built once — the search and the favourites use the same entries.
  const tabHere = new URLSearchParams(location.search).get('tab');
  const pages: NavEntry[] = (m.pages ?? [])
    .filter((p) => (!p.capability || can(actor, p.capability)) && (!p.resource || canReadResource(actor, p.resource)))
    .map((p) => {
      const path = pagePath(actor.workspaceId, m.id, p.path);
      // a page with ?tab= (dashboard sections) is active only on that tab; a plain page only without a tab
      const [pathname, query] = path.split('?');
      const active = location.pathname === pathname && (query ? new URLSearchParams(query).get('tab') === tabHere : !tabHere);
      return { key: `page:${p.id}`, label: p.label, path, icon: p.icon, active };
    });
  const groups = m.resources
    .filter((r) => canReadResource(actor, r))
    .map((rk) => {
      const res = getResource(rk);
      const views = listViews(actor, rk);
      const base = `${wsBase(actor.workspaceId)}/${res.module}/${rk}`;
      const current = location.pathname === base ? new URLSearchParams(location.search).get('view') ?? (settings.defaultViews[rk] || defaultViewId(rk)) : undefined;
      const withIcons = m.navChildIcons?.includes(rk);
      const items: NavEntry[] = views.map((v) => {
        const typeIcon = TYPE_ICON[v.type];
        return { key: `view:${v.id}`, label: v.name, path: `${base}?view=${v.id}`, icon: withIcons ? typeIcon : undefined, altIcon: typeIcon, active: current === v.id };
      });
      return { rk, label: res.labelPlural, items };
    });
  const all = [...pages, ...groups.flatMap((g) => g.items)];
  const needle = q.trim().toLowerCase();
  const results = needle ? all.filter((e) => e.label.toLowerCase().includes(needle)) : [];

  return (
    <>
      <div className="sidebar-head">
        <span className="sidebar-title">{m.label}</span>
        {headerAction}
      </div>
      <div className="sidebar-search">
        <Icon name="search" size={14} />
        <input type="search" placeholder={`Find a page (${all.length})`} aria-label="Find a page in this module" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      </div>
      <div className="sidebar-scroll">
        {/* Section separators are plain muted text. Rows WITH an icon: icon + text. Rows WITHOUT an icon
            (children of a group): text only, indented under the group label. ☆ on hover → Favorites (top). */}
        {needle ? (
          <>
            <span className="nav-section is-static">Results</span>
            {results.length ? (
              <ul className="nav-list">
                {results.map((e) => (
                  <NavItem key={e.key} entry={{ ...e, icon: e.icon ?? e.altIcon }} />
                ))}
              </ul>
            ) : (
              <p className="nav-empty muted">No pages match “{q}”.</p>
            )}
          </>
        ) : (
          <>
            {settings.favorites.length > 0 && (
              <>
                <span className="nav-section is-static">Favorites</span>
                <ul className="nav-list">
                  {settings.favorites.map((f) => (
                    <NavItem key={f.path} entry={{ key: f.path, label: f.label, path: f.path, icon: f.icon ?? 'table', active: here === f.path || location.pathname === f.path }} />
                  ))}
                </ul>
              </>
            )}
            {pages.length > 0 && <span className="nav-section is-static">Pages</span>}
            <ul className="nav-list">
              {pages.map((e) => (
                <NavItem key={e.key} entry={e} />
              ))}
              {m.id === 'admin' &&
                (m.pages ?? [])
                  .filter((p) => p.capability && !can(actor, p.capability))
                  .map((p) => (
                    <li key={p.id}>
                      <span className="nav-row is-disabled" data-tooltip={`Not available for ${actor.role.label}`}>
                        <Icon name="lock" />
                        <span className="nav-label">{p.label}</span>
                      </span>
                    </li>
                  ))}
            </ul>
            {groups.length > 0 && <span className="nav-section is-static">Menu</span>}
            {groups.map((g) => {
              const open = !collapsedGroups.has(g.rk);
              return (
                <div key={g.rk} className="nav-tree">
                  <button type="button" className="nav-row nav-toggle" aria-expanded={open} onClick={() => toggleGroup(g.rk)}>
                    <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                    <span className="nav-label">{g.label}</span>
                    <span className="nav-count">{g.items.length}</span>
                  </button>
                  {open && (
                    <ul className={cx('nav-list nav-children', g.items.some((e) => e.icon) && 'has-icons')}>
                      {g.items.map((e) => (
                        <NavItem key={e.key} entry={e} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {settings.pins.length > 0 && (
              <div className="nav-group">
                <span className="nav-section is-static">Pinned</span>
                <ul className="nav-list">
                  {settings.pins.map((p) => (
                    <li key={p.path} className="nav-pin">
                      <Link to={p.path} className={cx('nav-row', here === p.path && 'is-active')}>
                        <Icon name="pin" />
                        <span className="nav-label">{p.label}</span>
                      </Link>
                      <button type="button" className="nav-unpin" aria-label={`Unpin ${p.label}`} onClick={() => togglePin(actor, p.label, p.path)}>
                        <Icon name="x" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* No "Recent" section in the sidebar (owner, 2026-11-24); recent pages stay reachable from search (Ctrl K) */}
          </>
        )}
      </div>
    </>
  );
}

function ContextSidebar({ mod, collapsed = false }: { mod: string; collapsed?: boolean }) {
  const actor = useActor();
  const settings = getSettings(actor.user.id);
  const [width, setWidth] = useState(settings.sidebarWidth);
  const [dragging, setDragging] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  // Collapsed sidebar stays mounted for the animation but is not focusable or clickable.
  useEffect(() => {
    if (collapsed) navRef.current?.setAttribute('inert', '');
    else navRef.current?.removeAttribute('inert');
  }, [collapsed]);
  useEffect(() => setWidth(settings.sidebarWidth), [settings.sidebarWidth]);
  const startDrag = (x0: number) => {
    let w = width;
    setDragging(true);
    const move = (e: PointerEvent) => {
      w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width + (e.clientX - x0) / pageZoom()));
      setWidth(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      updateSettings(actor.user.id, { sidebarWidth: w });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <nav className={cx('sidebar', collapsed && 'is-collapsed', dragging && 'is-dragging')} style={{ width: collapsed ? 0 : width }} aria-label="Module navigation" aria-hidden={collapsed || undefined} ref={navRef}>
      <div className="sidebar-inner" style={{ width }}>
        <SidebarContent mod={mod} headerAction={<IconButton icon="panel-left" label="Collapse sidebar" onClick={() => updateSettings(actor.user.id, { sidebarCollapsed: true })} className="sidebar-toggle" />} />
      </div>
      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          startDrag(e.clientX);
        }}
        onDoubleClick={() => updateSettings(actor.user.id, { sidebarWidth: 240 })}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            updateSettings(actor.user.id, { sidebarWidth: width + (e.key === 'ArrowRight' ? 16 : -16) });
          }
        }}
      />
    </nav>
  );
}

function MobileNav({ mod, onClose: closeNow, onSearch, onHelp, showRail }: { mod: string; onClose: () => void; onSearch: () => void; onHelp: () => void; showRail: boolean }) {
  const actor = useActor();
  const location = useLocation();
  const unread = inboxUnreadCount(actor);
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const onClose = () => {
    if (!motionOK()) return closeNow();
    if (closing) return;
    setClosing(true);
    setTimeout(closeNow, EXIT_MS);
  };
  useLayer(true, onClose);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a,button')?.focus();
  }, []);
  return (
    <div className={cx("overlay-scrim overlay-scrim-left", closing && "is-closing")} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
        {showRail && (
          <div className="mobile-modules">
            {modules()
              .filter((m) => moduleVisible(actor, m))
              .map((m) => (
                <Link
                  key={m.id}
                  to={moduleLanding(actor, m)}
                  className={cx('mobile-module', mod === m.id && 'is-active')}
                  aria-current={mod === m.id ? 'page' : undefined}
                >
                  <Icon name={m.icon} />
                  <span>{m.label}</span>
                </Link>
              ))}
            {domain().id === 'rentio' && (
              <Link to={inboxPath(actor.workspaceId)} className={cx('mobile-module', isInboxPath(location.pathname) && 'is-active')} aria-current={isInboxPath(location.pathname) ? 'page' : undefined} aria-label={`Inbox${unread ? `, ${unread} unread` : ''}`}>
                <Icon name="inbox" />
                <span>Inbox{unread ? ` (${unread})` : ''}</span>
              </Link>
            )}
            <button type="button" className="mobile-module" onClick={onSearch}>
              <Icon name="search" />
              <span>Search</span>
            </button>
            <button type="button" className="mobile-module" onClick={onHelp}>
              <Icon name="help" />
              <span>Help</span>
            </button>
          </div>
        )}
        <div className="sidebar mobile-sidebar">
          <SidebarContent mod={mod} />
        </div>
        <IconButton icon="x" label="Close navigation" onClick={onClose} className="mobile-nav-close" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Top bar: workspace, notifications, account

function TopBar({ onMenu, showMenu, onSearch }: { onMenu: () => void; showMenu: boolean; onSearch: () => void }) {
  const actor = useActor();
  const phone = useMedia(PHONE); // on phones the rail is hidden, so theme + profile stay in the top bar
  const settings = getSettings(actor.user.id);
  return (
    <div className="topbar">
      <div className="topbar-left">
        {showMenu &&
          (settings.sidebarCollapsed && !window.matchMedia(TABLET).matches ? (
            <IconButton icon="panel-left" label="Expand sidebar" onClick={() => updateSettings(actor.user.id, { sidebarCollapsed: false })} />
          ) : (
            <IconButton icon="menu" label="Open navigation" onClick={onMenu} />
          ))}
        {/* Page title + ⓘ description are portalled here by <PageHeader>. */}
        <div id={TOPBAR_TITLE_SLOT} className="topbar-title" />
      </div>
      <button type="button" className="topbar-search" onClick={onSearch} aria-label="Search records, pages and actions (Ctrl+K)">
        <Icon name="search" size={14} />
        <span>Search…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="topbar-right">
        <WorkspaceSwitcher />
        {phone && <ThemeButton />}
        <NotificationBell />
        {phone && <AccountMenu />}
      </div>
    </div>
  );
}

function WorkspaceSwitcher() {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const ws = workspaces().find((w) => w.id === actor.workspaceId)!;
  return (
    <>
      <button ref={ref} type="button" className="ws-switch" data-tooltip={`${organization().name} / ${ws.name}`} aria-label={`Workspace: ${ws.name}. Switch workspace`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="building" size={14} />
        <span className="ws-name">{ws.name}</span>
        <Icon name="chevrons-up-down" size={14} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Switch clinic workspace" width={260}>
        <p className="pop-label dialog-title-row">
          {organization().name} · workspaces
          <InfoTip text="Records are isolated per workspace; links from one workspace never show another workspace’s data." label="About workspaces" />
        </p>
        <ul className="menu">
          {workspaces().map((w) => (
            <li key={w.id}>
              <button
                type="button"
                className={cx('menu-item', w.id === actor.workspaceId && 'is-current')}
                onClick={() => {
                  setOpen(false);
                  if (w.id === actor.workspaceId) return;
                  switchSession(actor.user.id, w.id);
                  const rest = location.pathname.split('/').slice(5).join('/') || 'dashboard';
                  navigate(`${wsBase(w.id)}/${rest}`);
                }}
              >
                <Icon name={w.id === actor.workspaceId ? 'check' : 'circle'} />
                <span className="menu-label">{w.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

function NotificationBell() {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const items = listNotifications(actor);
  const unread = items.filter((n) => !n.readAt).length;
  const go = (n: (typeof items)[number]) => {
    markNotification(actor, n.id, true);
    setOpen(false);
    if (!n.link) return;
    if ('page' in n.link) navigate(pagePath(actor.workspaceId, n.link.page === 'schedule' ? 'scheduling' : 'work', n.link.page));
    else navigate(recordPeekPath(actor.workspaceId, n.link.resource, n.link.recordId));
  };
  return (
    <>
      <IconButton ref={ref} icon="bell" label={`Notifications${unread ? `, ${unread} unread` : ''}`} badge={unread} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Notifications" width={360} align="end">
        <div className="pop-head">
          <span className="dialog-title-row">
            <strong>Notifications</strong>
            <InfoTip text="Reading a notification never approves or completes the linked work." label="About notifications" />
          </span>
          <Button variant="ghost" onClick={() => markAllRead(actor)} disabledReason={unread ? undefined : 'Nothing unread'}>
            Mark all read
          </Button>
        </div>
        {items.length ? (
          <ul className="notif-list">
            {items.slice(0, 12).map((n) => (
              <li key={n.id} className={cx('notif', !n.readAt && 'is-unread')}>
                <button type="button" className="notif-main" onClick={() => go(n)}>
                  {!n.readAt && <span className="unread-dot" aria-label="Unread" />}
                  <span>
                    <span className="notif-title">{n.title}</span>
                    <span className="muted small">
                      {n.kind.replace('_', ' ')} · {relativeTime(n.createdAt)}
                    </span>
                  </span>
                </button>
                <IconButton icon="calendar-clock" label="Snooze for 4 hours" onClick={() => snoozeNotification(actor, n.id, 4)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted pop-empty">You’re all caught up.</p>
        )}
        <Link className="pop-foot link" to={inboxPath(actor.workspaceId)} onClick={() => setOpen(false)}>
          Open {inboxLabel()}
        </Link>
      </Popover>
    </>
  );
}

/** Theme changer in the top bar: mode + colour palettes (presets and the user's own). */
function ThemeButton({ inRail = false }: { inRail?: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Palette | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      {inRail ? (
        <button ref={ref} type="button" className={cx('rail-item', open && 'is-active')} aria-label="Theme and colours" data-tooltip="Theme & colours" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name="palette" />
        </button>
      ) : (
        <IconButton ref={ref} icon="palette" label="Theme and colours" aria-haspopup="dialog" aria-expanded={open} pressed={open} onClick={() => setOpen((o) => !o)} />
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Theme and colours" width={360} align={inRail ? 'start' : 'end'} side={inRail ? 'right' : 'bottom'} className={cx('theme-pop', inRail && 'from-rail')}>
        <div className="pop-head">
          <strong>Theme</strong>
        </div>
        <ThemePicker
          onEditPalette={(p) => {
            setOpen(false);
            setEditing(p);
          }}
        />
      </Popover>
      {editing && <PaletteEditor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AccountMenu({ inRail = false }: { inRail?: boolean }) {
  const actor = useActor();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      {inRail ? (
        <button ref={ref} type="button" className={cx('rail-item rail-profile', open && 'is-active')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Account: ${actor.user.name}, ${actor.role.label}`} data-tooltip={`${actor.user.name} · ${actor.role.label}`}>
          <Avatar name={actor.user.name} size={30} />
        </button>
      ) : (
        <button ref={ref} type="button" className="account-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Account: ${actor.user.name}, ${actor.role.label}`}>
          <Avatar name={actor.user.name} size={26} />
          <span className="account-text hide-phone">
            <span className="account-name">{actor.user.name}</span>
            <span className="account-role">{actor.role.label}</span>
          </span>
        </button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Account and role" width={300} align={inRail ? 'start' : 'end'} side={inRail ? 'right' : 'bottom'} className={cx(inRail && 'from-rail')}>
        <p className="pop-label">Simulated sign-in (demo users)</p>
        <ul className="menu">
          {demoUsers().map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className={cx('menu-item', u.id === actor.user.id && 'is-current')}
                onClick={() => {
                  setOpen(false);
                  if (u.id === actor.user.id) return;
                  switchSession(u.id, actor.workspaceId);
                  // intentional demo role switch: if the new role cannot open this page, land on their My work
                  // (direct-URL guards still apply to anyone who types or follows a link to a page)
                  if (!routeAllowed(actorFor(u.id, actor.workspaceId), location.pathname)) navigate(domain().id === 'rentio' ? `${wsBase(actor.workspaceId)}/home/my-work` : `${wsBase(actor.workspaceId)}/dashboard`);
                  toast(`Now viewing as ${u.name} (${getRole(u.roleId).label})`, 'info');
                }}
              >
                <Avatar name={u.name} size={22} />
                <span className="menu-label">
                  {u.name}
                  <span className="menu-reason">{u.title ?? getRole(u.roleId).label}</span>
                </span>
                {u.id === actor.user.id && <Icon name="check" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="menu-sep" />
        <ul className="menu">
          <li>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                navigate(`/u/${actor.user.id}/my-work`);
              }}
            >
              <Icon name="inbox" />
              <span className="menu-label">My work</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                navigate(pagePath(actor.workspaceId, 'admin', 'settings'));
              }}
            >
              <Icon name="sliders" />
              <span className="menu-label">Personal settings</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="menu-item is-danger"
              onClick={() => {
                setOpen(false);
                setConfirmReset(true);
              }}
            >
              <Icon name="reset" />
              <span className="menu-label">Reset demo data…</span>
            </button>
          </li>
          {usesLoginGate() && (
            <li>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  // clears the demo session marker only — business data and personal settings stay
                  signOut();
                  navigate('/login', { replace: true });
                }}
              >
                <Icon name="log-out" />
                <span className="menu-label">Log out</span>
              </button>
            </li>
          )}
        </ul>
      </Popover>
      <ResetDialog open={confirmReset} onClose={() => setConfirmReset(false)} />
    </>
  );
}

export function ResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const rentio = domain().id === 'rentio';
  const doReset = (opts?: Record<string, unknown>) => {
    resetDb(opts);
    onClose();
    toast('Demo data reset', 'info');
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      role="alertdialog"
      title="Reset demo data?"
      description="Restores the original synthetic dataset in this browser. Your personal settings are kept."
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            Cancel
          </Button>
          {rentio ? (
            <>
              <Button variant="danger" onClick={() => doReset({ dataset: 'demo' })}>
                Demo snapshot
              </Button>
              <Button variant="danger" onClick={() => doReset({ dataset: 'start' })}>
                Reset to starting RT-001
              </Button>
              <Button variant="danger" onClick={() => doReset({ dataset: 'completed' })}>
                Reset to completed RT-001
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => doReset()}>
              Reset data
            </Button>
          )}
        </>
      }
    >
      <p className="muted">
        {rentio
          ? 'All Rentio transactions in this browser are replaced by a freshly replayed data set: “demo snapshot” (default) has RT-001 completed plus RT-003 waiting for a manual handover; “starting” has RT-001 ready to execute; “completed” has all RT-001 steps posted. Exception cases are included in all. Back up first from Presenter tools if you need the current data.'
          : 'All records, comments, approvals, views and configuration changes you made will be discarded.'}
      </p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Command palette

interface Cmd {
  id: string;
  label: string;
  hint: string;
  icon: string;
  run: () => void;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actor = useActor();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    const go = (to: string) => () => {
      onClose();
      navigate(to);
    };
    modules().forEach((m) => {
      (m.pages ?? []).filter((p) => (!p.capability || can(actor, p.capability)) && (!p.resource || canReadResource(actor, p.resource))).forEach((p) => out.push({ id: `p-${p.id}`, label: p.label, hint: m.label, icon: p.icon, run: go(pagePath(actor.workspaceId, m.id, p.path)) }));
      m.resources
        .filter((r) => canReadResource(actor, r))
        .forEach((r) => {
          const res = getResource(r);
          out.push({ id: `r-${r}`, label: res.labelPlural, hint: m.label, icon: res.icon === 'calendar' ? 'calendar' : res.icon, run: go(resourcePath(actor.workspaceId, r)) });
          listViews(actor, r).forEach((v) => out.push({ id: `v-${v.id}`, label: `${res.labelPlural}: ${v.name}`, hint: 'Saved view', icon: TYPE_ICON[v.type], run: go(resourcePath(actor.workspaceId, r, { view: v.id })) }));
        });
    });
    getSettings(actor.user.id).recents.forEach((r) => out.push({ id: `rec-${r.path}`, label: r.label, hint: 'Recent', icon: 'reset', run: go(r.path) }));
    return out;
  }, [actor.user.id, actor.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const records = useMemo(() => (open ? searchRecords(actor, q) : []), [q, open, actor.user.id, actor.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase();
  const list: Cmd[] = [
    ...records.map((h) => ({
      id: `rec-${h.resource}-${h.id}`,
      label: `${h.id} · ${h.title}`,
      hint: h.exact ? `${h.resourceLabel} · exact ID` : h.resourceLabel,
      icon: 'search',
      run: () => {
        onClose();
        navigate(recordPeekPath(actor.workspaceId, h.resource, h.id));
      },
    })),
    ...commands.filter((c) => !needle || c.label.toLowerCase().includes(needle)).slice(0, needle ? 12 : 10),
  ];

  return (
    <Dialog open={open} onClose={onClose} title="Search" description="Pages, saved views and records you can access. Search covers fields your role can see in full; masked fields are not searchable." size="md">
      <div className="palette">
        <input
          className="input"
          placeholder="Type a name, ID (e.g. P-1003) or page…"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={list[active] ? `pal-${list[active].id}` : undefined}
          value={q}
          data-autofocus
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(list.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && list[active]) {
              e.preventDefault();
              list[active].run();
            }
          }}
        />
        <ul id="palette-list" role="listbox" className="palette-list" aria-label="Results">
          {list.map((c, i) => (
            <li key={c.id} id={`pal-${c.id}`} role="option" aria-selected={i === active} className={cx('palette-item', i === active && 'is-active')} onMouseEnter={() => setActive(i)} onClick={c.run}>
              <Icon name={c.icon} />
              <span className="palette-label">{c.label}</span>
              <span className="muted small">{c.hint}</span>
            </li>
          ))}
          {!list.length && <li className="muted palette-empty">No results you can access.</li>}
        </ul>
      </div>
    </Dialog>
  );
}
