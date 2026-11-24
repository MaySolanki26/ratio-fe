import { type RefObject, useRef, useState } from 'react';
import type { FieldDefinition, RecordData, ResourceDefinition } from '../../metadata/types';
import { cx } from '../../lib/format';
import { type Actor, canUpdateRecord, fieldAccess } from '../../services/authz';
import { getDb } from '../../services/db';
import { activeMasterValues } from '../../services/registry';
import { updateRecord } from '../../services/runtime';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { useToast } from '../primitives/feedback';
import { Popover } from '../primitives/overlay';
import { relationOptions } from './FormFields';

/**
 * "More" in the bulk-action pill (owner rule 83): one row per field that can be set for every selected record
 * (label ›), and its values open in a side menu beside that row. Picking a value updates each selected record
 * the actor may edit; the rest are skipped and named in the toast.
 */
export function BulkMore({ res, actor, rows, onDone }: { res: ResourceDefinition; actor: Actor; rows: RecordData[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const subAnchor = useRef<HTMLElement | null>(null);
  const toast = useToast();

  const optionsFor = (f: FieldDefinition) =>
    f.type === 'master' ? activeMasterValues(f.master!).map((o) => ({ value: o.key, label: o.label, tone: o.tone })) : relationOptions(actor, f, {}).map((o) => ({ value: o.id, label: o.label, tone: undefined }));
  const fields = res.fields.filter(
    (f) =>
      (f.type === 'master' || (f.type === 'relation' && !f.relation?.filterBy)) &&
      f.key !== res.lifecycle?.field &&
      !f.readOnly &&
      !f.system &&
      !f.computed &&
      !f.masterParentField &&
      fieldAccess(actor, res, f) === 'edit' &&
      optionsFor(f).length > 0 &&
      optionsFor(f).length <= 30,
  );
  if (!fields.length) return null;
  const subField = fields.find((f) => f.key === sub);

  const close = () => {
    setSub(null);
    setOpen(false);
  };
  const apply = (f: FieldDefinition, value: string, label: string) => {
    let ok = 0;
    const skipped: string[] = [];
    rows.forEach((r) => {
      const raw = getDb().records[res.key]?.find((x) => x.id === r.id);
      try {
        if (!raw || !canUpdateRecord(actor, res, raw)) throw new Error('not editable');
        updateRecord(actor, res.key, r.id, { [f.key]: value }, raw.version);
        ok++;
      } catch {
        skipped.push(r.id);
      }
    });
    toast(`${f.label} → ${label}: ${ok} updated${skipped.length ? `, ${skipped.length} skipped (${skipped.join(', ')})` : ''}`, skipped.length ? 'info' : 'success');
    close();
    onDone();
  };

  return (
    <>
      <Button ref={btn} variant="ghost" icon="more" aria-haspopup="menu" aria-expanded={open} className={cx(open && 'is-open')} onClick={() => (open ? close() : setOpen(true))}>
        More
      </Button>
      <Popover open={open} onClose={close} anchor={btn} label="More bulk actions" align="end" width={220} className="bulk-more-pop">
        <div role="menu" aria-label="More bulk actions" className="bulk-more-list">
          {fields.map((f) => (
            <button
              key={f.key}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub === f.key}
              className={cx('menu-item bulk-more-item', sub === f.key && 'is-open')}
              onMouseEnter={(e) => {
                subAnchor.current = e.currentTarget;
                setSub(f.key);
              }}
              onClick={(e) => {
                subAnchor.current = e.currentTarget;
                setSub((s) => (s === f.key ? null : f.key));
              }}
            >
              <span>{f.label}</span>
              <Icon name="chevron-right" size={14} className="bulk-more-caret" />
            </button>
          ))}
        </div>
      </Popover>
      <Popover open={open && !!subField} onClose={() => setSub(null)} anchor={subAnchor as RefObject<HTMLElement>} label={subField ? `Set ${subField.label}` : 'Set value'} side="right" width={220} className="bulk-more-pop">
        {subField && (
          <div role="menu" aria-label={`Set ${subField.label} for ${rows.length} selected`} className="bulk-more-list">
            {optionsFor(subField).map((o) => (
              <button key={o.value} type="button" role="menuitem" className="menu-item" onClick={() => apply(subField, o.value, o.label)}>
                {o.tone && <span className={cx('opt-dot', `tone-${o.tone}`)} aria-hidden="true" />}
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        )}
      </Popover>
    </>
  );
}
