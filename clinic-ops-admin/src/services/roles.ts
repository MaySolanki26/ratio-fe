/**
 * Roles & access (owner rule 60): the role permission matrix and custom roles.
 * Built-in roles come from the domain pack and are read-only; custom roles are saved
 * in this browser. A production build must store and enforce roles on the server.
 */
import type { PermissionColumn, ResourcePermission, RoleDefinition } from '../metadata/types';
import { clinicPack } from '../domain/clinic/pack';
import { uid } from '../lib/ids';
import { type Actor, can } from './authz';
import { commit, getDb } from './db';
import { appendAudit } from './ledger';
import { allResources } from './registry';
import { ServiceError } from './types';

export const PERMISSION_COLUMNS: { key: PermissionColumn; label: string; help?: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'add', label: 'Add' },
  { key: 'update', label: 'Update' },
  { key: 'delete', label: 'Delete' },
  { key: 'sensitive', label: 'Sensitive data', help: 'See phone numbers and emails unmasked (masked by default, with an eye to reveal).' },
  { key: 'verify', label: 'Verify' },
  { key: 'approve', label: 'Approve / Reject' },
  { key: 'cancel', label: 'Cancel' },
  { key: 'export', label: 'Export' },
];

export interface RoleDraft {
  label: string;
  description: string;
  resources: Record<string, ResourcePermission>;
  capabilities: string[];
}

export interface MatrixCell {
  /** What the box grants, shown as its tooltip. */
  label: string;
  get: (d: RoleDraft) => boolean;
  set: (d: RoleDraft, on: boolean) => RoleDraft;
}
export interface MatrixRow {
  id: string;
  label: string;
  cells: Partial<Record<PermissionColumn, MatrixCell>>;
}
export interface MatrixGroup {
  id: string;
  label: string;
  rows: MatrixRow[];
}

const NONE: ResourcePermission = { read: 'none', create: false, update: 'none', delete: false, export: false };

const capCell = (capability: string, label: string): MatrixCell => ({
  label,
  get: (d) => d.capabilities.includes(capability),
  set: (d, on) => ({ ...d, capabilities: on ? [...new Set([...d.capabilities, capability])] : d.capabilities.filter((c) => c !== capability) }),
});

/** Module → rows (record types + extra capability rows), in navigation order. */
export function permissionMatrix(): MatrixGroup[] {
  const resources = allResources();
  const extra = clinicPack.capabilityRows ?? [];
  return clinicPack.modules
    .map((m) => {
      const rows: MatrixRow[] = [];
      for (const key of m.resources) {
        const res = resources.find((r) => r.key === key);
        if (!res) continue;
        const p = (d: RoleDraft) => d.resources[key] ?? NONE;
        const put = (d: RoleDraft, patch: Partial<ResourcePermission>) => {
          const next = { ...p(d), ...patch };
          // anything beyond View needs View; switching View off clears the row
          if (patch.read === 'none') Object.assign(next, { create: false, update: 'none', delete: false, export: false, sensitive_data: false });
          else if (next.read === 'none' && (next.create || next.update !== 'none' || next.delete || next.export || next.sensitive_data)) next.read = 'all';
          return { ...d, resources: { ...d.resources, [key]: next } };
        };
        const label = res.labelPlural.toLowerCase();
        const cells: MatrixRow['cells'] = {
          view: { label: `See ${label}`, get: (d) => p(d).read !== 'none', set: (d, on) => put(d, { read: on ? (p(d).read === 'none' ? 'all' : p(d).read) : 'none' }) },
          add: { label: `Create ${label}`, get: (d) => p(d).create, set: (d, on) => put(d, { create: on }) },
          update: { label: `Edit ${label}`, get: (d) => p(d).update !== 'none', set: (d, on) => put(d, { update: on ? (p(d).update === 'none' ? 'all' : p(d).update) : 'none' }) },
          delete: { label: `Delete ${label}`, get: (d) => p(d).delete, set: (d, on) => put(d, { delete: on }) },
          export: { label: `Export ${label}`, get: (d) => p(d).export, set: (d, on) => put(d, { export: on }) },
        };
        if (res.fields.some((f) => f.sensitivity === 'contact')) cells.sensitive = { label: `See unmasked phone / email of ${label}`, get: (d) => !!p(d).sensitive_data, set: (d, on) => put(d, { sensitive_data: on }) };
        for (const [col, a] of Object.entries(res.actionPermissions ?? {})) if (a) cells[col as PermissionColumn] = capCell(a.capability, a.label);
        rows.push({ id: key, label: res.labelPlural, cells });
      }
      for (const r of extra.filter((x) => x.module === m.id)) {
        const cells: MatrixRow['cells'] = {};
        for (const [col, c] of Object.entries(r.cells)) if (c) cells[col as PermissionColumn] = capCell(c.capability, c.label);
        rows.push({ id: r.id, label: r.label, cells });
      }
      return { id: m.id, label: m.label, rows };
    })
    .filter((g) => g.rows.length);
}

export const draftOf = (r: RoleDefinition): RoleDraft => ({ label: r.label, description: r.description, resources: structuredClone(r.resources), capabilities: [...r.capabilities] });
export const emptyDraft = (): RoleDraft => ({ label: '', description: '', resources: {}, capabilities: [] });

export function countPermissions(d: RoleDraft) {
  return permissionMatrix().reduce((n, g) => n + g.rows.reduce((m, r) => m + Object.values(r.cells).filter((c) => c!.get(d)).length, 0), 0);
}

export const builtInRoles = () => clinicPack.roles;
export const customRoles = () => getDb().customRoles ?? [];
export const allRoles = () => [...builtInRoles(), ...customRoles()];
export const isBuiltIn = (id: string) => builtInRoles().some((r) => r.id === id);
export const canManageRoles = (actor: Actor) => can(actor, 'config.publish');

/** Create or update a custom role (built-in roles are read-only — duplicate them instead). */
export function saveRole(actor: Actor, draft: RoleDraft, id?: string): RoleDefinition {
  if (!canManageRoles(actor)) throw new ServiceError('forbidden', 'Your role cannot manage roles');
  const label = draft.label.trim();
  if (!label) throw new ServiceError('validation', 'Give the role a name', { fieldErrors: { label: 'Give the role a name' } });
  if (allRoles().some((r) => r.id !== id && r.label.toLowerCase() === label.toLowerCase())) throw new ServiceError('validation', 'A role with this name already exists', { fieldErrors: { label: 'A role with this name already exists' } });
  if (id && isBuiltIn(id)) throw new ServiceError('forbidden', 'Built-in roles are read-only — duplicate it to customise');
  return commit((d) => {
    const list = d.customRoles ?? (d.customRoles = []);
    const existing = id ? list.find((r) => r.id === id) : undefined;
    const role: RoleDefinition = {
      id: existing?.id ?? uid('role'),
      label,
      description: draft.description.trim(),
      resources: draft.resources,
      capabilities: draft.capabilities,
      // field access by sensitivity class: kept from the role it was copied from, else a cautious default
      sensitivity: existing?.sensitivity ?? { identifier: 'view', health: 'hide', financial: 'view' },
    };
    if (existing) Object.assign(existing, role);
    else list.push(role);
    appendAudit(d, actor, { action: existing ? 'role.updated' : 'role.created', summary: `${existing ? 'Updated' : 'Created'} role "${label}"`, correlationId: uid('cor') });
    return role;
  });
}

export function deleteRole(actor: Actor, id: string) {
  if (!canManageRoles(actor)) throw new ServiceError('forbidden', 'Your role cannot manage roles');
  commit((d) => {
    const r = d.customRoles?.find((x) => x.id === id);
    if (!r) return;
    d.customRoles = d.customRoles!.filter((x) => x.id !== id);
    appendAudit(d, actor, { action: 'role.deleted', summary: `Deleted role "${r.label}"`, correlationId: uid('cor') });
  });
}
