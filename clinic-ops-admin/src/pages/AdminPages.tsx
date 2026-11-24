import { type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ChipStyle, MasterDefinition, RecordData, Tone } from '../metadata/types';
import { cx } from '../lib/format';
import { recordPeekPath } from '../lib/routes';
import { tokenRegistry } from '../tokens/tokens';
import { can } from '../services/authz';
import { addDraftField, discardDraft, draftSummary, ensureDraft, getDraft, type NewFieldSpec, publishDraft, removeDraftField, revertDraftMaster, setDraftMaster, validateDraft, type ConfigIssue } from '../services/config';
import { getDb } from '../services/db';
import { useActor, useRevision } from '../services/hooks';
import { allMasters, allResources, getMaster, getResource, getUser } from '../services/registry';
import { getSettings, updateSettings } from '../services/settings';
import { ServiceError } from '../services/types';
import { Button, IconButton } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { Badge, EmptyState, InlineAlert, NoAccess, StatusChip, Tabs, useToast } from '../components/primitives/feedback';
import { PageHeader } from '../components/shell/PageHeader';
import { SelectMenu } from '../components/primitives/SelectMenu';
import { DatePicker } from '../components/primitives/DatePicker';
import { InfoTip } from '../components/primitives/InfoTip';
import { ResetDialog } from '../components/shell/AppShell';
import { confirmDelete, Dialog } from '../components/primitives/overlay';
import { relativeTime } from '../lib/dates';
import { DateText, EmptyValue } from '../components/primitives/display';
import { ThemePicker } from '../components/shell/ThemePicker';
import { RolesList } from './RolesPage';
import { applyListFilters, ListFilterButton, type ListColumn, ListGrid, ListToolbar } from '../components/resource/ListGrid';

const TONES: Tone[] = ['neutral', 'info', 'success', 'warning', 'danger', 'accent'];

// ---------------------------------------------------------------- Configuration studio

type StudioTab = 'masters' | 'fields' | 'registry' | 'history';

export function StudioPage() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const [tab, setTab] = useState<StudioTab>('masters');
  const [issues, setIssues] = useState<ConfigIssue[] | null>(null);
  const draft = getDraft();
  if (!can(actor, 'config.publish')) return <NoAccess what="the configuration studio" />;
  const summary = draft ? draftSummary(draft) : [];
  const errors = issues?.filter((i) => i.severity === 'error') ?? [];

  // draft / published note + validation: inside the editor column on split tabs so the divider runs top to bottom (rule 79)
  const notice = (
    <>
      {draft ? (
        <InlineAlert tone="info" title={`Draft by ${getUser(draft.createdBy)?.name} · updated ${relativeTime(draft.updatedAt)}`}>
          {summary.length ? `${summary.length} pending change(s). Changes are not live until published.` : 'No changes yet.'}
        </InlineAlert>
      ) : (
        <p className="muted studio-note">Published configuration V{getDb().config.version}. Start a draft to make changes.</p>
      )}
      {issues && (
        <section className="panel validation" aria-live="polite">
          <h2 className="panel-title">Validation & preview</h2>
          {issues.length === 0 && <p className="text-success">No issues found.</p>}
          <ul className="plain-list">
            {issues.map((i, n) => (
              <li key={n} className={i.severity === 'error' ? 'text-danger' : 'text-warning'}>
                <Icon name="alert" size={12} /> <strong>{i.severity === 'error' ? 'Error' : 'Warning'}:</strong> {i.message}
              </li>
            ))}
          </ul>
          {summary.length > 0 && (
            <>
              <h3 className="detail-section-title">Changes to publish</h3>
              <ul className="plain-list bullets">
                {summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
  const split = tab === 'masters' || tab === 'registry';
  return (
    <div className="page studio-page">
      <PageHeader
        title="Configuration studio"
        description="Edit masters and add fields through Draft → Validate → Preview → Publish. Published versions are immutable; changes propagate to every form, grid, filter and inspector."
        crumbs={[{ label: 'Administration' }, { label: 'Configuration studio' }]}
      />
      <Tabs<StudioTab>
        label="Studio sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'masters', label: 'Masters' },
          { id: 'fields', label: 'Custom fields' },
          { id: 'registry', label: 'Metadata registry' },
          { id: 'history', label: 'Published versions', count: getDb().config.history.length },
        ]}
        extra={
          draft ? (
            <>
              <Button
                onClick={() =>
                  confirmDelete({
                    title: 'Discard this draft?',
                    message: 'All unpublished master and field changes in the draft are lost. Published configuration is not affected.',
                    confirmLabel: 'Discard draft',
                    onConfirm: () => {
                      discardDraft(actor);
                      setIssues(null);
                      toast('Draft discarded', 'info');
                    },
                  })
                }
              >
                Discard draft
              </Button>
              <Button icon="check" onClick={() => setIssues(validateDraft(draft))}>
                Validate
              </Button>
              <Button
                variant="primary"
                disabledReason={!issues ? 'Validate the draft first' : errors.length ? `${errors.length} validation error(s)` : !summary.length ? 'No changes to publish' : undefined}
                onClick={() => {
                  try {
                    publishDraft(actor);
                    setIssues(null);
                    toast('Configuration published');
                  } catch (e) {
                    toast(e instanceof ServiceError ? e.message : 'Publish failed', 'danger');
                  }
                }}
              >
                Publish
              </Button>
            </>
          ) : (
            <Button variant="primary" icon="pencil" onClick={() => ensureDraft(actor)}>
              Start draft
            </Button>
          )
        }
      />
      {!split && notice}
      <div className={cx('content-surface', split && 'is-split')} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'masters' && <MastersEditor notice={notice} onChange={() => setIssues(null)} />}
        {tab === 'fields' && <FieldsEditor onChange={() => setIssues(null)} />}
        {tab === 'registry' && <Registry notice={notice} />}
        {tab === 'history' && <History />}
      </div>
    </div>
  );
}

const CHIP_STYLES: { value: ChipStyle; label: string }[] = [
  { value: 'outline', label: 'Outline' },
  { value: 'soft', label: 'Soft' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'dot', label: 'Dot' },
  { value: 'text', label: 'Text' },
];

const MASTER_VALUE_COLUMNS: ListColumn[] = [
  { key: 'key', label: 'Key (immutable)', width: 130, sortable: false },
  { key: 'label', label: 'Label', width: 170, sortable: false },
  { key: 'tone', label: 'Tone', width: 160, sortable: false },
  { key: 'preview', label: 'Preview', width: 150, sortable: false },
  { key: 'active', label: 'Active', width: 120, sortable: false },
  { key: 'parent', label: 'Parent', width: 90, sortable: false },
];
const REGISTRY_COLUMNS: ListColumn[] = [
  { key: 'label', label: 'Field', width: 200 },
  { key: 'key', label: 'Key', width: 170 },
  { key: 'type', label: 'Type', width: 200 },
  { key: 'rules', label: 'Rules', width: 240 },
  { key: 'sensitivity', label: 'Sensitivity', width: 130 },
  { key: 'usedIn', label: 'Used in', width: 220 },
];
const TOKEN_COLUMNS: ListColumn[] = [
  { key: 'name', label: 'Token', width: 220 },
  { key: 'cssVar', label: 'CSS variable', width: 240 },
  { key: 'value', label: 'Value', width: 320 },
  { key: 'status', label: 'Status', width: 160 },
];

function MastersEditor({ notice, onChange }: { notice: ReactNode; onChange: () => void }) {
  const actor = useActor();
  const masters = allMasters();
  const [sel, setSel] = useState(masters[0].key);
  const [newLabel, setNewLabel] = useState('');
  const draft = getDraft();
  const editing = draft?.masters[sel];
  const m: MasterDefinition = editing ?? getMaster(sel);
  const editable = !!draft;
  const write = (next: MasterDefinition) => {
    setDraftMaster(actor, next);
    onChange();
  };
  const setVal = (key: string, patch: Partial<MasterDefinition['values'][number]>) => write({ ...m, values: m.values.map((v) => (v.key === key ? { ...v, ...patch } : v)) });
  const move = (key: string, d: -1 | 1) => {
    const sorted = [...m.values].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((v) => v.key === key);
    const j = i + d;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    write({ ...m, values: sorted.map((v, k) => ({ ...v, order: k })) });
  };
  return (
    <div className="studio-split">
      <nav className="studio-list" aria-label="Masters">
        <ul className="nav-list">
          {masters.map((x) => (
            <li key={x.key}>
              <button type="button" className={cx('nav-row', sel === x.key && 'is-active')} onClick={() => setSel(x.key)} aria-current={sel === x.key ? 'true' : undefined}>
                <span className="nav-label">{x.label}</span>
                {draft?.masters[x.key] && <span className="nav-meta">draft</span>}
                <span className="nav-meta">V{x.version}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="studio-editor">
        {notice}
        <div className="panel-head">
          <div>
            <h2 className="panel-title dialog-title-row">
              {m.label}
              <InfoTip text="Values cannot be deleted — deactivate them so historical records keep their meaning." label="About master values" />
            </h2>
            <p className="muted small">
              Key <code>{m.key}</code> · published V{getMaster(sel).version}
              {m.description ? ` · ${m.description}` : ''}
            </p>
          </div>
          {editing && (
            <Button variant="ghost" icon="reset" onClick={() => revertDraftMaster(actor, sel)}>
              Revert changes
            </Button>
          )}
        </div>
        {!editable && <InlineAlert tone="info">Read-only. Start a draft to edit values.</InlineAlert>}
        <div className="form-field studio-chip-style">
          <span className="field-label-row">
            <span className="field-label">Chip style</span>
            <InfoTip text="How these values look in tables, cards and details: Outline (coloured text + light border), Soft (light tint), Neutral (grey tag), Dot (coloured dot + text) or Text (no box). Status fields always use the filled status pill." label="About chip styles" />
          </span>
          <div className="segmented" role="radiogroup" aria-label="Chip style">
            {CHIP_STYLES.map((cs) => {
              const on = (m.chipStyle ?? (m.values.some((x) => (x.tone ?? 'neutral') !== 'neutral') ? 'outline' : 'text')) === cs.value;
              return (
                <button key={cs.value} type="button" role="radio" aria-checked={on} disabled={!editable} className={cx('seg-btn', on && 'is-on')} onClick={() => write({ ...m, chipStyle: cs.value })}>
                  {cs.label}
                </button>
              );
            })}
          </div>
        </div>
        <ListGrid
          resKey="master_values"
          label="Value"
          labelPlural="Values"
          columns={MASTER_VALUE_COLUMNS}
          rows={[...m.values].sort((a, b) => a.order - b.order).map((v) => ({ id: v.key, key: v.key, label: v.label, tone: v.tone ?? 'neutral', active: v.active ? 'Active' : 'Inactive', parent: v.parent ?? '', version: 1 }) as unknown as RecordData)}
          actor={actor}
          rowActions={{ view: false, edit: false }}
          renderCell={(key, r) => {
            const v = m.values.find((x) => x.key === r.id)!;
            if (key === 'key') return <code>{v.key}</code>;
            if (key === 'label') return <input className="input input-compact" placeholder="Enter label" aria-label={`Label for ${v.key}`} value={v.label} disabled={!editable} onClick={(e) => e.stopPropagation()} onChange={(e) => setVal(v.key, { label: e.target.value })} />;
            // tone picker and its chip preview sit in their own columns
            if (key === 'tone')
              return (
                <span className="tone-cell" onClick={(e) => e.stopPropagation()}>
                  <SelectMenu label={`Tone for ${v.key}`} value={v.tone ?? 'neutral'} disabled={!editable} options={TONES.map((t) => ({ value: t, label: t, tone: t }))} onChange={(t) => setVal(v.key, { tone: t as Tone })} />
                </span>
              );
            if (key === 'preview') return <StatusChip label={v.label || v.key} tone={v.tone} />;
            if (key === 'active')
              return (
                <label className="switch" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" role="switch" checked={v.active} disabled={!editable} onChange={(e) => setVal(v.key, { active: e.target.checked })} aria-label={`${v.key} active`} />
                  <span className="switch-track" aria-hidden="true" />
                  <span className="small">{v.active ? 'Active' : 'Inactive'}</span>
                </label>
              );
            if (key === 'parent') return v.parent ?? <EmptyValue />;
            return undefined;
          }}
          rowMenu={(r) => [
            { id: 'up', label: 'Move up', icon: 'arrow-up', onSelect: () => move(r.id, -1), disabledReason: editable ? undefined : 'Start a draft to edit values' },
            { id: 'down', label: 'Move down', icon: 'arrow-down', onSelect: () => move(r.id, 1), disabledReason: editable ? undefined : 'Start a draft to edit values' },
          ]}
        />
        {editable && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const label = newLabel.trim();
              if (!label) return;
              const key = label
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_|_$/g, '')
                .replace(/^(\d)/, 'v_$1');
              write({ ...m, values: [...m.values, { key, label, tone: 'neutral', active: true, order: m.values.length }] });
              setNewLabel('');
            }}
          >
            <label className="sr-only" htmlFor="new-master-value">
              New value label
            </label>
            <input id="new-master-value" className="input input-compact" placeholder="New value label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <Button type="submit" icon="plus" disabled={!newLabel.trim()}>
              Add value
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

function FieldsEditor({ onChange }: { onChange: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const draft = getDraft();
  const resources = allResources();
  const [spec, setSpec] = useState<NewFieldSpec>({ resource: 'patients', key: '', label: '', type: 'text', required: false, sensitivity: 'none' });
  const set = (p: Partial<NewFieldSpec>) => setSpec((s) => ({ ...s, ...p }));
  const custom = resources.flatMap((r) => (getDb().config.customFields[r.key] ?? []).map((f) => ({ r, f })));
  return (
    <div className="fields-editor">
      <section className="panel">
        <h2 className="panel-title">Add a field</h2>
        {!draft && <InlineAlert tone="info">Start a draft to add fields.</InlineAlert>}
        <form
          className="form-grid cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              addDraftField(actor, spec);
              onChange();
              toast(`Field "${spec.label}" added to draft`);
              setSpec((s) => ({ ...s, key: '', label: '', defaultValue: undefined, help: '' }));
            } catch (err) {
              toast(err instanceof ServiceError ? err.message : 'Failed', 'danger');
            }
          }}
        >
          <div className="form-field">
            <label className="field-label" htmlFor="nf-res">
              Record type
            </label>
            <SelectMenu id="nf-res" block label="Record type" value={spec.resource} disabled={!draft} options={resources.map((r) => ({ value: r.key, label: r.labelPlural }))} onChange={(v) => set({ resource: v })} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-label">
              Label <span className="req">*</span>
            </label>
            <input
              id="nf-label"
              className="input"
              placeholder="e.g. Preferred pharmacy"
              value={spec.label}
              disabled={!draft}
              onChange={(e) =>
                set({
                  label: e.target.value,
                  key: e.target.value
                    .trim()
                    .replace(/[^a-zA-Z0-9 ]/g, '')
                    .split(/\s+/)
                    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]?.toUpperCase() + w.slice(1).toLowerCase()))
                    .join(''),
                })
              }
            />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-key">
              Key (immutable after publish)
            </label>
            <input id="nf-key" className="input mono" placeholder="e.g. preferredPharmacy" value={spec.key} disabled={!draft} onChange={(e) => set({ key: e.target.value })} />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-type">
              Type
            </label>
            <SelectMenu
              id="nf-type"
              block
              label="Type"
              value={spec.type}
              disabled={!draft}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'longtext', label: 'Long text' },
                { value: 'number', label: 'Number' },
                { value: 'date', label: 'Date' },
                { value: 'boolean', label: 'Yes / No' },
                { value: 'master', label: 'Choice from master list' },
              ]}
              onChange={(v) => set({ type: v as NewFieldSpec['type'], defaultValue: undefined })}
            />
          </div>
          {spec.type === 'master' && (
            <div className="form-field">
              <label className="field-label" htmlFor="nf-master">
                Master list
              </label>
              <SelectMenu id="nf-master" block label="Master list" placeholder="Choose…" value={spec.master ?? ''} disabled={!draft} options={allMasters().map((m) => ({ value: m.key, label: m.label }))} onChange={(v) => set({ master: v })} />
            </div>
          )}
          <div className="form-field">
            <label className="field-label" htmlFor="nf-sens">
              Sensitivity
            </label>
            <SelectMenu
              id="nf-sens"
              block
              label="Sensitivity"
              value={spec.sensitivity ?? 'none'}
              disabled={!draft}
              options={[
                { value: 'none', label: 'None' },
                { value: 'identifier', label: 'Identifier (masked for some roles)' },
                { value: 'health', label: 'Health-related (hidden from front desk & billing)' },
                { value: 'financial', label: 'Financial (hidden from clinicians)' },
              ]}
              onChange={(v) => set({ sensitivity: v as NewFieldSpec['sensitivity'] })}
            />
          </div>
          <div className="form-field">
            <label className="check">
              <input type="checkbox" checked={spec.required} disabled={!draft} onChange={(e) => set({ required: e.target.checked })} /> Required
            </label>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="nf-default">
              Default value {spec.required ? '(needed for existing records)' : '(optional)'}
            </label>
            {spec.type === 'boolean' ? (
              <SelectMenu
                id="nf-default"
                block
                label="Default value"
                value={spec.defaultValue === undefined ? '' : String(spec.defaultValue)}
                disabled={!draft}
                options={[
                  { value: '', label: 'None' },
                  { value: 'true', label: 'Yes' },
                  { value: 'false', label: 'No' },
                ]}
                onChange={(v) => set({ defaultValue: v === '' ? undefined : v === 'true' })}
              />
            ) : spec.type === 'master' && spec.master ? (
              <SelectMenu id="nf-default" block label="Default value" value={String(spec.defaultValue ?? '')} disabled={!draft} options={[{ value: '', label: 'None' }, ...getMaster(spec.master).values.map((v) => ({ value: v.key, label: v.label }))]} onChange={(v) => set({ defaultValue: v || undefined })} />
            ) : spec.type === 'date' ? (
              <DatePicker id="nf-default" block label="Default value" value={String(spec.defaultValue ?? '')} disabled={!draft} onChange={(v) => set({ defaultValue: v ?? undefined })} />
            ) : (
              <input
                id="nf-default"
                className="input"
                placeholder="Optional default value"
                type={spec.type === 'number' ? 'number' : 'text'}
                value={String(spec.defaultValue ?? '')}
                disabled={!draft}
                onChange={(e) => set({ defaultValue: e.target.value === '' ? undefined : spec.type === 'number' ? Number(e.target.value) : e.target.value })}
              />
            )}
          </div>
          <div className="form-field span-2">
            <label className="field-label" htmlFor="nf-help">
              Help text <span className="optional">(optional)</span>
            </label>
            <input id="nf-help" className="input" placeholder="Short hint shown under the field" value={spec.help ?? ''} disabled={!draft} onChange={(e) => set({ help: e.target.value })} />
          </div>
          <div className="span-2">
            <Button type="submit" icon="plus" disabledReason={!draft ? 'Start a draft first' : !spec.label.trim() || !spec.key ? 'Enter a label' : undefined}>
              Add to draft
            </Button>
          </div>
        </form>
      </section>
      {draft && draft.newFields.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">In this draft</h2>
          <ul className="plain-list">
            {draft.newFields.map(({ resource, field }) => (
              <li key={field.id} className="row-between">
                <span>
                  {getResource(resource).labelPlural} › <strong>{field.label}</strong> <code>{field.key}</code> · {field.type}
                  {field.required ? ' · required' : ''}
                  {field.sensitivity && field.sensitivity !== 'none' ? ` · ${field.sensitivity}` : ''}
                </span>
                <IconButton icon="trash" label={`Remove ${field.label} from draft`} onClick={() =>
                    confirmDelete({
                      title: `Remove "${field.label}" from the draft?`,
                      message: 'The new field is taken out of this draft. You can add it again before publishing.',
                      confirmLabel: 'Remove',
                      onConfirm: () => removeDraftField(actor, field.id),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel">
        <h2 className="panel-title">Published custom fields</h2>
        {custom.length ? (
          <ul className="plain-list">
            {custom.map(({ r, f }) => (
              <li key={f.id}>
                {r.labelPlural} › <strong>{f.label}</strong> <code>{f.key}</code> · {f.type} — available in forms, grid columns, filters and the inspector.
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None yet. Published fields appear in the Column manager, filters, forms (“Additional fields”) and inspector for every permitted role.</p>
        )}
      </section>
    </div>
  );
}

function Registry({ notice }: { notice: ReactNode }) {
  const actor = useActor();
  const resources = allResources();
  const [sel, setSel] = useState(resources[0].key);
  const res = getResource(sel);
  return (
    <div className="studio-split">
      <nav className="studio-list" aria-label="Resources">
        <ul className="nav-list">
          {resources.map((r) => (
            <li key={r.key}>
              <button type="button" className={cx('nav-row', sel === r.key && 'is-active')} onClick={() => setSel(r.key)}>
                <span className="nav-label">{r.labelPlural}</span>
                <span className="nav-meta">V{r.version}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="studio-editor">
        {notice}
        <h2 className="panel-title">{res.labelPlural}</h2>
        <p className="muted small">
          <code>{res.id}</code> · module {res.module} · {res.fields.length} fields · {res.status}
          {res.lifecycle ? ` · lifecycle on “${res.lifecycle.field}” (${res.lifecycle.transitions.length} transitions)` : ''}
        </p>
        <ListGrid
          key={res.key}
          resKey="registry"
          label="Field"
          labelPlural="Fields"
          columns={REGISTRY_COLUMNS}
          rows={res.fields.map((f) => ({
            id: f.id,
            label: f.label,
            key: f.key,
            type: `${f.type}${f.master ? ` → ${f.master}` : f.relation ? ` → ${f.relation.resource}` : ''}`,
            rules: [f.required && 'required', f.requiredWhen && `required when ${f.requiredWhen.field} ${f.requiredWhen.op} ${String(f.requiredWhen.value)}`, f.visibleWhen && 'conditional', f.computed && 'computed', f.compare && `≥ ${f.compare.field}`, f.masterParentField && `depends on ${f.masterParentField}`, f.relation?.filterBy && `filtered by ${f.relation.filterBy.fromField}`].filter(Boolean).join(', '),
            sensitivity: f.sensitivity && f.sensitivity !== 'none' ? f.sensitivity : '',
            usedIn: Object.entries(f.capabilities).filter(([, on]) => on).map(([k]) => k).join(', '),
            custom: f.custom ? 'yes' : '',
            version: 1,
          }) as unknown as RecordData)}
          actor={actor}
          rowActions={{ view: false, edit: false }}
          renderCell={(key, r) => (key === 'key' ? <code>{String(r.key)}</code> : key === 'label' ? <span>{String(r.label)} {r.custom ? <Badge tone="accent">custom</Badge> : null}</span> : key === 'sensitivity' ? (r.sensitivity ? <Badge tone="warning">{String(r.sensitivity)}</Badge> : <EmptyValue />) : undefined)}
          rowMenu={(r) => [{ id: 'copy', label: 'Copy field key', icon: 'copy', onSelect: () => navigator.clipboard?.writeText(String(r.key)).catch(() => {}) }]}
        />
      </section>
    </div>
  );
}

function History() {
  const h = getDb().config.history;
  if (!h.length) return <EmptyState icon="scroll-text" title="No published changes yet">The shipped domain pack is version 1.</EmptyState>;
  return (
    <ol className="timeline">
      {h.map((v) => (
        <li key={v.id} className="timeline-item">
          <span className="timeline-dot" aria-hidden="true" />
          <div>
            <p>
              <strong>V{v.version}</strong> published by {getUser(v.publishedBy)?.name} · <span className="muted"><DateText value={v.publishedAt} showTime /></span>
            </p>
            <ul className="change-list">
              {v.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- Roles & access


export function AccessPage() {
  useRevision();
  const actor = useActor();
  if (!can(actor, 'access.view')) return <NoAccess what="roles & access" />;
  return (
    <div className="page access-page">
      <PageHeader title="Roles & access" description="Roles and what each one can see and do. Built-in roles ship with the clinic pack; custom roles are saved in this browser." crumbs={[{ label: 'Administration' }, { label: 'Roles & access' }]} />
      {/* roles table → each role opens its permission page (owner rules 60, 65) */}
      <RolesList />
    </div>
  );
}

// ---------------------------------------------------------------- Audit log

const AUDIT_COLUMNS: ListColumn[] = [
  { key: 'at', label: 'When', type: 'datetime', width: 180 },
  { key: 'actorName', label: 'Actor', width: 190 },
  { key: 'action', label: 'Action', width: 130 },
  { key: 'recordId', label: 'Record', width: 120 },
  { key: 'summary', label: 'Summary', width: 420 },
  { key: 'correlation', label: 'Correlation', width: 130 },
];

export function AuditPage() {
  useRevision();
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  if (!can(actor, 'audit.view')) return <NoAccess what="the audit log" />;
  const all = getDb().audit.filter((a) => a.workspaceId === actor.workspaceId);
  const byId = new Map(all.map((a) => [a.id, a]));
  let rows = all.slice(0, 300).map((a) => ({ id: a.id, at: a.at, actorName: getUser(a.actorId)?.name ?? a.actorId, action: a.action, resource: a.resource ?? '', recordId: a.recordId ?? '', summary: a.summary, correlation: a.correlationId.slice(-8), version: 1 }) as unknown as RecordData);
  rows = applyListFilters(rows, filters);
  if (q.trim()) rows = rows.filter((r) => `${r.summary} ${r.recordId} ${r.actorName} ${r.correlation}`.toLowerCase().includes(q.trim().toLowerCase()));
  const opts = (k: string) => [...new Set(all.map((a) => String((a as unknown as Record<string, unknown>)[k] ?? '')).filter(Boolean))].sort().map((v) => ({ value: v, label: v }));
  return (
    <div className="page access-page">
      <PageHeader title="Audit log" description="Append-only record of who changed what. Sensitive values are redacted. Local simulation — not tamper-evident; a production ledger lives server-side." crumbs={[{ label: 'Administration' }, { label: 'Audit log' }]} />
      <ListToolbar
        search={q}
        onSearch={setQ}
        placeholder="Search summary, record, person, correlation ID"
        filter={
          <ListFilterButton
            filters={[
              { key: 'action', label: 'Action', icon: 'activity', options: opts('action') },
              { key: 'resource', label: 'Record type', icon: 'f-relation', options: opts('resource') },
            ]}
            values={filters}
            onChange={setFilters}
          />
        }
        count={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
        info="Append-only record of who changed what. Sensitive values are redacted. Local simulation — not tamper-evident; a production ledger lives server-side."
      />
      {rows.length ? (
        <ListGrid
          resKey="audit"
          label="Audit entry"
          labelPlural="Audit entries"
          columns={AUDIT_COLUMNS}
          rows={rows}
          highlight={q}
          actor={actor}
          onOpen={(id) => {
            const a = byId.get(id);
            if (a?.recordId && a.resource) navigate(recordPeekPath(actor.workspaceId, a.resource, a.recordId));
          }}
          viewBlockedReason={(r) => (r.recordId ? undefined : 'No record linked to this entry')}
          rowActions={{ view: true, edit: false }}
          renderCell={(key, r) => {
            const a = byId.get(r.id)!;
            if (key === 'actorName')
              return (
                <span className="cell-two">
                  <span>{String(r.actorName)}</span>
                  <span className="muted small">
                    {a.actorRole}
                    {a.actorType !== 'user' ? ` · ${a.actorType}` : ''}
                  </span>
                </span>
              );
            if (key === 'action') return <code>{a.action}</code>;
            if (key === 'correlation') return <code className="small">{String(r.correlation)}</code>;
            if (key === 'recordId') return a.recordId && a.resource ? <Link className="rel-link" to={recordPeekPath(actor.workspaceId, a.resource, a.recordId)} onClick={(e) => e.stopPropagation()}>{a.recordId}</Link> : <EmptyValue />;
            if (key === 'summary')
              return (
                <span className="cell-two">
                  <span>{a.summary}</span>
                  {open === a.id && a.changes && (
                    <span className="change-inline small">
                      {a.changes.map((c) => (
                        <span key={c.field}>
                          {c.label}: <span className="muted">{c.before}</span> → {c.after}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              );
            return undefined;
          }}
          rowMenu={(r) => {
            const a = byId.get(r.id)!;
            return [
              ...(a.changes?.length ? [{ id: 'changes', label: open === a.id ? 'Hide changes' : `Show ${a.changes.length} change(s)`, icon: 'list', onSelect: () => setOpen(open === a.id ? null : a.id) }] : []),
              { id: 'corr', label: 'Copy correlation ID', icon: 'copy', onSelect: () => (navigator.clipboard?.writeText(a.correlationId).catch(() => {}), toast('Correlation ID copied', 'success')) },
            ];
          }}
        />
      ) : (
        <EmptyState icon="scroll-text" title="No audit entries yet">
          Create, edit or change the status of a record and it will be recorded here.
        </EmptyState>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Event trace

const EVENT_COLUMNS: ListColumn[] = [
  { key: 'eventType', label: 'Event type', width: 220 },
  { key: 'recordId', label: 'Record', width: 120 },
  { key: 'actorName', label: 'Actor', width: 170 },
  { key: 'occurredAt', label: 'When', type: 'datetime', width: 180 },
  { key: 'delivery', label: 'Delivery', width: 120 },
];

export function EventsPage() {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  if (!can(actor, 'events.view')) return <NoAccess what="the event trace" />;
  const all = getDb().events.filter((e) => e.workspaceId === actor.workspaceId);
  let rows = all.slice(0, 300).map((e) => ({ id: e.eventId, eventType: e.eventType, recordId: e.recordId ?? '', actorName: getUser(e.actorId)?.name ?? '', occurredAt: e.occurredAt, delivery: 'Simulated', version: 1 }) as unknown as RecordData);
  rows = applyListFilters(rows, filters);
  if (q.trim()) rows = rows.filter((r) => `${r.eventType} ${r.recordId} ${r.actorName}`.toLowerCase().includes(q.trim().toLowerCase()));
  const selected = all.find((e) => e.eventId === sel);
  return (
    <div className="page access-page">
      <PageHeader title="Event trace" description="Versioned domain events written to a simulated outbox. Nothing is delivered to other systems; events with a repeated idempotency key are recorded once." crumbs={[{ label: 'Administration' }, { label: 'Event trace' }]} />
      <ListToolbar
        search={q}
        onSearch={setQ}
        placeholder="Search event type, record, person"
        filter={<ListFilterButton filters={[{ key: 'eventType', label: 'Event type', icon: 'activity', options: [...new Set(all.map((e) => e.eventType))].sort().map((t) => ({ value: t, label: t })) }]} values={filters} onChange={setFilters} />}
        count={`${rows.length} ${rows.length === 1 ? 'event' : 'events'}`}
        info="Versioned domain events written to a simulated outbox. Nothing is delivered to other systems; events with a repeated idempotency key are recorded once."
        actions={
          <Button icon="reset" disabledReason="Replay requires an authorized server-side workflow runtime">
            Replay events
          </Button>
        }
      />
      {rows.length ? (
        <ListGrid
          resKey="events"
          label="Event"
          labelPlural="Events"
          columns={EVENT_COLUMNS}
          rows={rows}
          highlight={q}
          actor={actor}
          onOpen={(id) => setSel(id)}
          rowActions={{ view: true, edit: false }}
          renderCell={(key, r) => (key === 'eventType' ? <code>{String(r.eventType)}</code> : key === 'recordId' ? (r.recordId ? <span className="mono">{String(r.recordId)}</span> : <EmptyValue />) : key === 'delivery' ? <Badge tone="neutral">simulated</Badge> : undefined)}
          rowMenu={(r) => [
            { id: 'show', label: 'Show envelope', icon: 'eye', onSelect: () => setSel(r.id) },
            { id: 'copy', label: 'Copy event ID', icon: 'copy', onSelect: () => (navigator.clipboard?.writeText(r.id).catch(() => {}), toast('Event ID copied', 'success')) },
          ]}
        />
      ) : (
        <EmptyState icon="activity" title="No events yet">
          Events appear when records, comments, approvals or configuration change.
        </EmptyState>
      )}
      <Dialog open={!!selected} onClose={() => setSel(null)} size="lg" title="Event Envelope" description="Full event envelope (simulated outbox).">
        {selected && (
          <>
            <p className="event-head">
              <code>{selected.eventType}</code>
              {selected.recordId && <span className="mono muted"> · {selected.recordId}</span>}
            </p>
            <pre className="json">{JSON.stringify(selected, null, 2)}</pre>
          </>
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- Settings

export function SettingsPage() {
  useRevision();
  const actor = useActor();
  const s = getSettings(actor.user.id);
  const [reset, setReset] = useState(false);
  const set = (p: Parameters<typeof updateSettings>[1]) => updateSettings(actor.user.id, p);
  const db = getDb();
  return (
    <div className="page settings-page">
      <PageHeader title="Settings" description="Personal preferences are stored for your demo user in this browser. Platform rules (accessibility, security) cannot be overridden." crumbs={[{ label: 'Administration' }, { label: 'Settings' }]} />
      <div className="settings-grid">
        <section className="panel">
          <h2 className="panel-title">Appearance</h2>
          {/* Theme changer: mode + colour palettes (presets and custom). Replaces the separate rail-skin picker —
              presets cover the locked rail skins (charcoal, navy, black, light). */}
          {/* one line: Mode · Navigation density · Sidebar (owner rule 77), then the palettes */}
          <div className="appearance-row">
            <div className="form-field">
              <span className="field-label">Mode</span>
              <div className="segmented" role="radiogroup" aria-label="Colour mode">
                {(['system', 'light', 'dark'] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={s.theme === t} className={cx('seg-btn', s.theme === t && 'is-on')} onClick={() => set({ theme: t })}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-field">
              <span className="field-label" id="nav-density-label">Navigation density</span>
              <div className="segmented" role="group" aria-labelledby="nav-density-label">
                {(['balanced', 'compact'] as const).map((d) => (
                  <button key={d} type="button" className={cx('seg-btn', s.navDensity === d && 'is-on')} aria-pressed={s.navDensity === d} onClick={() => set({ navDensity: d })}>
                    {d === 'balanced' ? 'Balanced (34px)' : 'Compact (30px)'}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-field">
              <span className="field-label">Sidebar · {s.sidebarWidth}px</span>
              <div className="row-gap">
                <Button onClick={() => set({ sidebarWidth: 240, sidebarCollapsed: false })}>Reset to 240px</Button>
                <Button onClick={() => set({ sidebarCollapsed: !s.sidebarCollapsed })}>{s.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}</Button>
              </div>
            </div>
          </div>
          <ThemePicker showMode={false} />
        </section>
        <section className="panel">
          <h2 className="panel-title">Feature preferences</h2>
          {/* Display size (owner, 2026-11-24): the whole app smaller or larger, like browser zoom; 100% by default */}
          <div className="form-field">
            <span className="field-label" id="zoom-label">
              Display size
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="zoom-label">
              {[80, 90, 100, 110].map((z) => (
                <button key={z} type="button" role="radio" aria-checked={(s.zoom ?? 100) === z} className={cx('seg-btn', (s.zoom ?? 100) === z && 'is-on')} onClick={() => set({ zoom: z })}>
                  {z}%{z === 100 ? ' (default)' : ''}
                </button>
              ))}
            </div>
            <p className="field-help muted">Makes everything smaller or larger — text, tables, charts and menus. Saved for you in this browser.</p>
          </div>
        </section>
        <section className="panel">
          <h2 className="panel-title">Workspace & locale</h2>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Clinic time</dt>
              <dd>Times are clinic wall-clock times (no timezone conversion in this prototype).</dd>
            </div>
            <div className="detail-row">
              <dt>Currency</dt>
              <dd>USD — display formatting only; stored amounts are never converted.</dd>
            </div>
            <div className="detail-row">
              <dt>Date & number format</dt>
              <dd>Follows your browser locale ({navigator.language}).</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2 className="panel-title">Demo data</h2>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Dataset</dt>
              <dd>
                Synthetic seed {db.seed}, generated <DateText value={db.seededAt} showTime />
              </dd>
            </div>
            <div className="detail-row">
              <dt>Storage</dt>
              <dd>This browser’s localStorage only (key “uab.clinic-ops.db.v1”).</dd>
            </div>
            <div className="detail-row">
              <dt>Records</dt>
              <dd>
                {Object.entries(db.records)
                  .map(([k, v]) => `${v.length} ${k}`)
                  .join(' · ')}
              </dd>
            </div>
          </dl>
          <Button variant="danger" icon="reset" onClick={() => setReset(true)}>
            Reset demo data…
          </Button>
          <ResetDialog open={reset} onClose={() => setReset(false)} />
        </section>
        <section className="panel span-all">
          <h2 className="panel-title dialog-title-row">
            Design tokens
            <InfoTip text="Soft Enterprise tokens. “Locked” values come from the UAB 2.0 master specification; “proposed” values fill gaps and need design approval." label="About design tokens" />
          </h2>
          <ListGrid
            resKey="tokens"
            label="Token"
            labelPlural="Tokens"
            columns={TOKEN_COLUMNS}
            rows={tokenRegistry.map((t) => ({ id: t.name, name: t.name, cssVar: t.cssVar, value: `${t.value}${t.note ? ` · ${t.note}` : ''}`, status: t.status, version: 1 }) as unknown as RecordData)}
            actor={actor}
            rowActions={{ view: false, edit: false }}
            renderCell={(key, r) => (key === 'cssVar' ? <code>{String(r.cssVar)}</code> : key === 'status' ? <Badge tone={String(r.status).startsWith('locked') ? 'success' : 'warning'}>{String(r.status)}</Badge> : undefined)}
            rowMenu={(r) => [{ id: 'copy', label: 'Copy CSS variable', icon: 'copy', onSelect: () => navigator.clipboard?.writeText(String(r.cssVar)).catch(() => {}) }]}
          />
        </section>
      </div>
    </div>
  );
}
