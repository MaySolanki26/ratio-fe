import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PermissionColumn, RecordData } from '../metadata/types';
import { applyListFilters, ListFilterButton, type ListColumn, ListGrid, ListToolbar } from '../components/resource/ListGrid';
import { cx } from '../lib/format';
import { pagePath } from '../lib/routes';
import { can } from '../services/authz';
import { useActor, useRevision } from '../services/hooks';
import { demoUsers } from '../domain/active';
import { allRoles, canManageRoles, countPermissions, deleteRole, draftOf, emptyDraft, isBuiltIn, type MatrixCell, type MatrixGroup, PERMISSION_COLUMNS, permissionMatrix, type RoleDraft, saveRole } from '../services/roles';
import { ServiceError } from '../services/types';
import { Button } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { InfoTip } from '../components/primitives/InfoTip';
import { InlineAlert, NoAccess, useToast } from '../components/primitives/feedback';
import { confirmDelete } from '../components/primitives/overlay';
import { PageHeader } from '../components/shell/PageHeader';
import { useUnsavedGuard } from '../components/resource/RecordForm';

type Tri = 'none' | 'some' | 'all';
const triOf = (cells: MatrixCell[], d: RoleDraft): Tri => {
  const on = cells.filter((c) => c.get(d)).length;
  return on === 0 ? 'none' : on === cells.length ? 'all' : 'some';
};

/** Square checkbox with a partial (dash) state for "All" and module rows. */
function TriCheck({ state, label, disabled, onChange }: { state: Tri; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" className="perm-check" checked={state === 'all'} aria-label={label} data-tooltip={label} disabled={disabled} onChange={() => onChange(state !== 'all')} />;
}

const NotApplicable = () => (
  <span className="perm-na" aria-label="Not applicable">
    —
  </span>
);

// ---------------------------------------------------------------- Roles list (Roles & access page)

const ROLE_COLUMNS: ListColumn[] = [
  { key: 'label', label: 'Role', width: 200 },
  { key: 'description', label: 'Description', width: 400 },
  { key: 'kind', label: 'Type', width: 110 },
  { key: 'users', label: 'Users', type: 'number', width: 100 },
  { key: 'permissions', label: 'Permissions', type: 'number', width: 130 },
];

/** Roles list = the shared list table (rule 66): one toolbar row (search · Filters … count · ⓘ · Create role). */
export function RolesList() {
  useRevision();
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const manage = canManageRoles(actor);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const rolePath = (id: string) => `${pagePath(actor.workspaceId, 'admin', 'access')}/roles/${id}`;
  const all = allRoles();
  let rows: RecordData[] = all.map(
    (r) =>
      ({
        id: r.id,
        label: r.label,
        description: r.description || '',
        kind: isBuiltIn(r.id) ? 'Built-in' : 'Custom',
        users: demoUsers().filter((u) => u.roleId === r.id).length,
        permissions: countPermissions(draftOf(r)),
        version: 1,
      }) as unknown as RecordData,
  );
  rows = applyListFilters(rows, filters);
  if (q.trim()) rows = rows.filter((r) => `${r.label} ${r.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  const remove = (id: string) => {
    const r = all.find((x) => x.id === id)!;
    confirmDelete({
      title: `Delete role "${r.label}"?`,
      message: 'The role is removed. Users who had it need another role.',
      confirmLabel: 'Delete role',
      onConfirm: () => {
        deleteRole(actor, id);
        toast(`Role "${r.label}" deleted`);
      },
    });
  };
  return (
    <>
      <ListToolbar
        search={q}
        onSearch={setQ}
        placeholder="Search roles"
        filter={
          <ListFilterButton
            filters={[{ key: 'kind', label: 'Type', icon: 'f-status', options: [{ value: 'Built-in', label: 'Built-in' }, { value: 'Custom', label: 'Custom' }] }]}
            values={filters}
            onChange={setFilters}
          />
        }
        count={`${rows.length} ${rows.length === 1 ? 'role' : 'roles'}`}
        info="These rules are enforced by the in-browser service layer so the prototype behaves realistically. They are not a security boundary — a production build must enforce them on the server."
        actions={
          <Button icon="plus" onClick={() => navigate(rolePath('new'))} disabledReason={manage ? undefined : `${actor.role.label} cannot manage roles`}>
            Create role
          </Button>
        }
      />
      <ListGrid
        resKey="roles"
        label="Role"
        labelPlural="Roles"
        columns={ROLE_COLUMNS}
        rows={rows}
        highlight={q}
        actor={actor}
        onOpen={(id) => navigate(rolePath(id))}
        onEdit={(id) => navigate(rolePath(id))}
        editBlockedReason={(r) => (!manage ? `${actor.role.label} cannot manage roles` : isBuiltIn(r.id) ? 'Built-in roles are read-only — duplicate to customise' : undefined)}
        rowMenu={(r) => [
          { id: 'open', label: 'Open', icon: 'eye', onSelect: () => navigate(rolePath(r.id)) },
          { id: 'dup', label: 'Duplicate', icon: 'copy', onSelect: () => navigate(`${rolePath('new')}?from=${r.id}`), disabledReason: manage ? undefined : `${actor.role.label} cannot manage roles` },
          { id: 'delete', label: 'Delete role', icon: 'trash', danger: true, separatorBefore: true, disabledReason: !manage ? `${actor.role.label} cannot manage roles` : isBuiltIn(r.id) ? 'Built-in roles cannot be deleted' : undefined, onSelect: () => remove(r.id) },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- Create / edit role (owner reference design)

export function RolePage() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const navigate = useNavigate();
  const { roleId = 'new' } = useParams();
  const [params] = useSearchParams();
  const isNew = roleId === 'new';
  const source = allRoles().find((r) => r.id === (isNew ? params.get('from') : roleId));
  const builtIn = !isNew && isBuiltIn(roleId);
  const readOnly = builtIn || !canManageRoles(actor);
  const initial = useMemo<RoleDraft>(() => (source ? { ...draftOf(source), label: isNew ? `${source.label} (copy)` : source.label } : emptyDraft()), [roleId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<RoleDraft>(initial);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups: MatrixGroup[] = useMemo(() => permissionMatrix(), []);
  const listPath = pagePath(actor.workspaceId, 'admin', 'access');
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const guard = useUnsavedGuard(dirty && !readOnly, () => navigate(listPath));
  if (!can(actor, 'access.view')) return <NoAccess what="roles & access" />;
  if (!isNew && !source) return <NoAccess what="this role (it was deleted or never existed)" />;

  const total = countPermissions(draft);
  const colCells = (cells: (MatrixCell | undefined)[]) => cells.filter((c): c is MatrixCell => !!c);
  const setMany = (cells: MatrixCell[], on: boolean) => setDraft((d) => cells.reduce((acc, c) => c.set(acc, on), d));

  const save = () => {
    try {
      const r = saveRole(actor, draft, isNew ? undefined : roleId);
      toast(isNew ? `Role "${r.label}" created` : `Role "${r.label}" saved`, 'success');
      navigate(`${listPath}/roles/${r.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ServiceError ? e.fieldErrors?.label ?? e.message : 'Could not save the role');
    }
  };

  const title = isNew ? 'Create role' : builtIn ? source!.label : `Edit role · ${source!.label}`;
  return (
    <div className="page role-page">
      <PageHeader
        title={title}
        description="Choose what this role can see and do in each module."
        onBack={guard.requestClose}
        backLabel="Roles & access"
      />
      {builtIn && (
        <InlineAlert tone="info">
          Built-in role from the clinic pack — read-only. {canManageRoles(actor) ? 'Duplicate it to make a custom version.' : ''}
        </InlineAlert>
      )}
      <section className="role-card">
        {/* first row (owner rule 72): no section titles — permission count left, actions right */}
        <header className="role-card-head">
          <span className="muted" aria-live="polite">
            {total} {total === 1 ? 'permission' : 'permissions'} selected
          </span>
          <span className="spacer" />
          <div className="role-actions">
            {readOnly ? (
            <>
              {canManageRoles(actor) && (
                <Button icon="copy" onClick={() => navigate(`${listPath}/roles/new?from=${roleId}`)}>
                  Duplicate to customise
                </Button>
              )}
            </>
          ) : (
            <>
              {!isNew && (
                <Button
                  icon="trash"
                  variant="ghost"
                  onClick={() =>
                    confirmDelete({
                      title: `Delete role "${source!.label}"?`,
                      message: 'The role is removed. Users who had it need another role.',
                      confirmLabel: 'Delete role',
                      onConfirm: () => {
                        deleteRole(actor, roleId);
                        toast(`Role "${source!.label}" deleted`);
                        navigate(listPath);
                      },
                    })
                  }
                >
                  Delete
                </Button>
              )}
              <Button icon="reset" onClick={() => (setDraft(initial), setError(''))} disabledReason={dirty ? undefined : 'Nothing to reset'}>
                Reset
              </Button>
              <Button variant="primary" icon="check" onClick={save}>
                {isNew ? 'Create role' : 'Save changes'}
              </Button>
            </>
            )}
          </div>
        </header>
        <div className="role-details">
          <div className={cx('form-field', error && 'has-error')}>
            <label className="field-label" htmlFor="role-name">
              Role name <span className="req">*</span>
            </label>
            <input id="role-name" className="input" placeholder="e.g. Billing lead" value={draft.label} disabled={readOnly} maxLength={40} aria-invalid={!!error || undefined} onChange={(e) => (setDraft({ ...draft, label: e.target.value }), setError(''))} data-autofocus />
            {error && <span className="field-error">{error}</span>}
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="role-desc">
              Description
            </label>
            <input id="role-desc" className="input" placeholder="Brief description of this role" value={draft.description} disabled={readOnly} maxLength={120} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
        </div>
        <div className="perm-wrap" tabIndex={0} aria-label="Permission matrix (scrolls)">
          <table className="perm-table">
            <thead>
              <tr>
                <th scope="col" className="perm-name">
                  Module / resource
                </th>
                <th scope="col">All</th>
                {PERMISSION_COLUMNS.map((c) => (
                  <th key={c.key} scope="col">
                    <span className="perm-th">
                      {c.label}
                      {c.help && <InfoTip text={c.help} label={`About ${c.label}`} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const open = !collapsed.has(g.id);
                const groupCells = g.rows.flatMap((r) => colCells(Object.values(r.cells)));
                return (
                  <GroupRows key={g.id}>
                    <tr className="perm-group">
                      <th scope="rowgroup" className="perm-name">
                        <button type="button" className="perm-toggle" aria-expanded={open} onClick={() => setCollapsed((s) => (s.has(g.id) ? (s.delete(g.id), new Set(s)) : new Set(s.add(g.id))))}>
                          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                          {g.label}
                        </button>
                      </th>
                      <td>
                        <TriCheck state={triOf(groupCells, draft)} label={`All permissions in ${g.label}`} disabled={readOnly} onChange={(on) => setMany(groupCells, on)} />
                      </td>
                      {PERMISSION_COLUMNS.map((c) => {
                        const cells = colCells(g.rows.map((r) => r.cells[c.key as PermissionColumn]));
                        return <td key={c.key}>{cells.length ? <TriCheck state={triOf(cells, draft)} label={`${c.label}: all of ${g.label}`} disabled={readOnly} onChange={(on) => setMany(cells, on)} /> : <NotApplicable />}</td>;
                      })}
                    </tr>
                    {open &&
                      g.rows.map((r) => {
                        const rowCells = colCells(Object.values(r.cells));
                        return (
                          <tr key={r.id}>
                            <th scope="row" className="perm-name perm-child">
                              {r.label}
                            </th>
                            <td>
                              <TriCheck state={triOf(rowCells, draft)} label={`All permissions for ${r.label}`} disabled={readOnly} onChange={(on) => setMany(rowCells, on)} />
                            </td>
                            {PERMISSION_COLUMNS.map((c) => {
                              const cell = r.cells[c.key as PermissionColumn];
                              return <td key={c.key}>{cell ? <TriCheck state={cell.get(draft) ? 'all' : 'none'} label={cell.label} disabled={readOnly} onChange={(on) => setDraft((d) => cell.set(d, on))} /> : <NotApplicable />}</td>;
                            })}
                          </tr>
                        );
                      })}
                  </GroupRows>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted small role-note">Roles are saved in this browser and enforced by the in-browser service layer. A production build stores and enforces them on the server; assigning users to roles needs that server.</p>
      {guard.dialog}
    </div>
  );
}

function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
