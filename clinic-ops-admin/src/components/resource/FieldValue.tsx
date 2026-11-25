/**
 * Typed cell renderer registry. One renderer per field type, used by grid,
 * board cards, inspector details and related lists — permission-aware.
 */
import { Link } from 'react-router-dom';
import type { FieldAccess, FieldDefinition, MasterValue } from '../../metadata/types';
import { todayKey } from '../../lib/dates';
import { cx, formatMoney, pct } from '../../lib/format';
import { RESTRICTED } from '../../lib/phiMask';
import { recordPeekPath } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { canReadResource } from '../../services/authz';
import { getDb } from '../../services/db';
import { getMaster, getResource, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { isEmpty } from '../../services/validation';
import { Icon } from '../primitives/Icon';
import { isDragClick } from '../../lib/dragGuard';
import { MaskedField, StatusChip } from '../primitives/feedback';
import { DateText, EmptyValue } from '../primitives/display';
import { OverflowChips } from '../primitives/OverflowChips';
import { AvatarStack, ImageTile, PersonChip } from '../primitives/People';

/** Subtitle of a related person (e.g. their role), from `personSubtitle`. */
export function personSubtitle(field: FieldDefinition, resource: string, id: unknown): string | undefined {
  if (!field.personSubtitle) return undefined;
  const row = getDb().records[resource]?.find((r) => r.id === id);
  const f = getResource(resource).fields.find((x) => x.key === field.personSubtitle);
  if (!row || !f) return undefined;
  return f.master ? masterValue(f.master, row[f.key])?.label : String(row[f.key] ?? '');
}

/** Durations (min / h / days) get a clock icon like other time values. */
const isTimeUnit = (u?: string) => !!u && /^(min|mins|minutes|h|hrs|hours|days?)$/i.test(u);

/** Photo of a related record (e.g. a staff member) when the target resource has an image field. */
export function photoOf(resource: string, id: unknown): string | null {
  const row = getDb().records[resource]?.find((r) => r.id === id);
  return (row?.photo as string | undefined) ?? null;
}

const STATUS_LIKE = new Set(['status', 'urgency', 'priority']);

export function MasterChip({ master, value, plain }: { master: string; value: unknown; plain?: boolean }) {
  const mv: MasterValue | undefined = masterValue(master, value);
  if (!mv) return isEmpty(value) ? <EmptyValue /> : <span>{String(value)}</span>;
  const label = mv.active ? mv.label : `${mv.label} (inactive)`;
  if (plain) {
    // Non-status values use the master's chip style (owner rule 47): outline · soft · neutral · dot · text.
    // Default: outline when the values carry colours, otherwise plain text (no box where colour means nothing).
    const m = getMaster(master);
    const meaningful = m.values.some((x) => (x.tone ?? 'neutral') !== 'neutral');
    const style = m.chipStyle ?? (meaningful ? 'outline' : 'text');
    if (style === 'text') return <span>{label}</span>;
    if (style === 'dot')
      return (
        <span className={cx('dot-chip', `tone-${mv.tone ?? 'neutral'}`)}>
          <span className="opt-dot" aria-hidden="true" />
          <span className="chip-label">{label}</span>
        </span>
      );
    // the full text shows as a tooltip only when the label is truncated (TooltipLayer)
    return (
      <span className={cx('ref-chip', `chip-${style}`, `tone-${style === 'neutral' ? 'neutral' : mv.tone ?? 'neutral'}`)}>
        <span className="chip-label">{label}</span>
      </span>
    );
  }
  return <StatusChip label={label} tone={mv.tone ?? 'neutral'} />;
}

export function FieldValue({
  field,
  value,
  access,
  actor,
  linkRelations = true,
  rich = false,
}: {
  field: FieldDefinition;
  value: unknown;
  access: FieldAccess;
  actor: Actor;
  linkRelations?: boolean;
  /** Multi-line (rich) views: people show as avatar + name (+ subtitle). */
  rich?: boolean;
}) {
  if (access === 'hide') return null;
  // Contact data follows the phi-masking contract: masked by default; Eye reveal only when granted.
  if (field.type === 'phone' || field.type === 'email') {
    return <MaskedField value={value} type={field.type} canReveal={access === 'edit' || access === 'view'} />;
  }
  if (access === 'mask') {
    if (isEmpty(value)) return <EmptyValue />;
    return (
      <span className="restricted" data-tooltip="Restricted for your role">
        <Icon name="lock" size={12} />
        {value === RESTRICTED ? 'Restricted' : String(value)}
      </span>
    );
  }
  if (isEmpty(value) && field.type !== 'progress' && field.type !== 'boolean') return <EmptyValue />;

  switch (field.type) {
    case 'master':
      // Status-like masters = filled status pill; every other master value = Attio "domain-style" outlined chip
      return <MasterChip master={field.master!} value={value} plain={!STATUS_LIKE.has(field.key)} />;
    case 'multimaster': {
      // tags: each value keeps its master colour (soft chip); "+N" when they do not fit (owner rule 81)
      const keys = value as string[];
      const toned = getMaster(field.master!).values.some((x) => (x.tone ?? 'neutral') !== 'neutral');
      return <OverflowChips items={keys.map((k) => masterValue(field.master!, k)?.label ?? k)} tones={toned ? keys.map((k) => masterValue(field.master!, k)?.tone ?? 'neutral') : undefined} label={field.label} />;
    }
    case 'url': {
      const href = String(value);
      const safe = /^https?:\/\//i.test(href);
      if (!safe) return <span>{href}</span>;
      // Attio-style: just the site's name, underlined (owner rule 82) — full address on hover
      let shown = href;
      try {
        const parts = new URL(href).hostname.replace(/^www\./i, '').split('.');
        shown = parts.length > 2 ? parts[parts.length - 2] : parts[0];
      } catch {
        /* keep the raw address */
      }
      return (
        <a className="url-link" href={href} target="_blank" rel="noopener noreferrer" data-tooltip={href} onClick={(e) => e.stopPropagation()}>
          {shown}
        </a>
      );
    }
    case 'relation': {
      const target = field.relation!.resource;
      const title = recordTitle(target, value, actor);
      const exists = getDb().records[target]?.some((r) => r.id === value);
      // Icon before the value wherever one fits (person for staff, the related resource's icon otherwise)
      const valueIcon = target === 'staff' ? 'f-person' : getResource(target).icon;
      const body =
        rich && field.display === 'person' ? (
          <PersonChip name={title} src={photoOf(target, value)} subtitle={personSubtitle(field, target, value)} />
        ) : (
          <span className="value-with-icon">
            {getResource(target).person ? (
              // owner rule 67: people show a small avatar (photo or initials), never a generic person icon
              <ImageTile src={photoOf(target, value)} name={title} size={18} shape="circle" />
            ) : (
              <Icon name={valueIcon} size={14} className="value-icon" />
            )}
            <span className="value-text">{title}</span>
          </span>
        );
      if (!linkRelations || !exists || !canReadResource(actor, target)) return <span>{body}</span>;
      return (
        <Link className="rel-link" to={recordPeekPath(actor.workspaceId, target, String(value))} onClick={(e) => {
          e.stopPropagation();
          if (isDragClick(e)) e.preventDefault(); // selecting text never navigates
        }}>
          {body}
        </Link>
      );
    }
    case 'people': {
      const target = field.relation!.resource;
      const ids = value as string[];
      return <AvatarStack people={ids.map((id) => ({ name: recordTitle(target, id, actor), src: photoOf(target, id), subtitle: personSubtitle(field, target, id) }))} label={field.label} />;
    }
    case 'image':
      return <ImageTile src={String(value)} name={field.label} size={32} />;
    case 'date': {
      const overdue = /due|bookBy/i.test(field.key + field.label) && String(value) < todayKey();
      return (
        <span className={cx('date-cell value-with-icon', overdue && 'text-danger')}>
          <Icon name="calendar" size={14} className="value-icon" />
          <DateText value={String(value)} />
          {overdue && <span className="sr-only"> (overdue)</span>}
          {overdue && <Icon name="alert" size={12} className="inline-icon" />}
        </span>
      );
    }
    case 'datetime':
      return (
        <span className="value-with-icon">
          <Icon name="calendar-clock" size={14} className="value-icon" />
          <DateText value={String(value)} showTime />
        </span>
      );
    case 'money':
      return (
        <span className="num value-with-icon">
          <Icon name="f-money" size={14} className="value-icon" />
          <span>{formatMoney(Number(value), field.currency)}</span>
        </span>
      );
    case 'number':
      return (
        <span className={cx('num', isTimeUnit(field.unit) && 'value-with-icon')}>
          {isTimeUnit(field.unit) && <Icon name="f-datetime" size={14} className="value-icon" />}
          <span>
            {String(value)}
            {field.unit && <span className="muted"> {field.unit}</span>}
          </span>
        </span>
      );
    case 'progress': {
      const n = Math.max(0, Math.min(1, Number(value) || 0));
      return (
        <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(n * 100)} aria-label={field.label}>
          <span className="meter-track">
            <span className="meter-fill" style={{ width: `${n * 100}%` }} />
          </span>
          <span className="meter-text">{pct(n)}</span>
        </span>
      );
    }
    case 'boolean':
      return (
        <span className="bool">
          <Icon name={value ? 'check' : 'x'} size={14} />
          {value ? 'Yes' : 'No'}
        </span>
      );
    case 'identifier':
      return <span className="mono">{String(value)}</span>;
    case 'lineitems':
      return <span>{(value as unknown[]).length} item(s)</span>;
    case 'longtext':
      return <span className="clamp-2">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}
