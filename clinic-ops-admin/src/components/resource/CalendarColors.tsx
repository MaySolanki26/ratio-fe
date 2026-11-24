import { useRef, useState } from 'react';
import type { FieldDefinition, RecordData, ResourceDefinition } from '../../metadata/types';
import { cx } from '../../lib/format';
import type { Actor } from '../../services/authz';
import { activeMasterValues, getResource, masterValue } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { getSettings, updateSettings } from '../../services/settings';
import { IconButton } from '../primitives/Button';
import { Popover } from '../primitives/overlay';
import { SelectMenu } from '../primitives/SelectMenu';

/**
 * Personal calendar colours (owner rule 97): the user picks what events are coloured by — status, any choice field
 * (type, visit mode…) or a lane person / place (clinician, room) — and their own colour for each value.
 * Saved per user (like the colour palette). Values without a chosen colour keep their master tone, or get a
 * colour from a fixed readable set (people / places).
 */

/** Readable default set for people / places (validated categorical order — dataviz). */
export const CAL_SWATCHES = ['#2a78d6', '#1baf7a', '#eda100', '#e87ba4', '#7c5cd6', '#eb6834', '#e5484d', '#0e9aa7', '#64748b'];
/** the swatch each status / choice tone starts from (so the panel always shows the real current colour) */
const TONE_HEX: Record<string, string> = { info: '#2a78d6', success: '#1baf7a', warning: '#eda100', accent: '#7c5cd6', danger: '#e5484d', neutral: '#64748b' };

/** give every value its own colour: saved choice first, else its preferred default, else the next unused swatch */
function assignUnique(items: { key: string; saved?: string; preferred?: string }[]) {
  const used = new Set(items.map((i) => i.saved?.toLowerCase()).filter(Boolean) as string[]);
  return items.map((i) => {
    if (i.saved) return i.saved;
    const pick = i.preferred && !used.has(i.preferred) ? i.preferred : CAL_SWATCHES.find((h) => !used.has(h)) ?? i.preferred ?? CAL_SWATCHES[0];
    used.add(pick);
    return pick;
  });
}

type ColourBy = { key: string; label: string; field: FieldDefinition };

/** Fields events can be coloured by: the status field first, then other choice fields, then the lane fields. */
export function colourByOptions(res: ResourceDefinition): ColourBy[] {
  const statusKey = res.lifecycle?.field ?? 'status';
  const laneKeys = (res.calendar?.lanes ?? []).map((l) => l.field);
  const pick = (f: FieldDefinition | undefined) => (f ? [{ key: f.key, label: f.label, field: f }] : []);
  const status = res.fields.find((f) => f.key === statusKey && f.type === 'master');
  const masters = res.fields.filter((f) => f.type === 'master' && f !== status && f.capabilities.list);
  const lanes = laneKeys.map((k) => res.fields.find((f) => f.key === k)).filter((f): f is FieldDefinition => !!f);
  return [...pick(status), ...masters.flatMap(pick), ...lanes.flatMap(pick)];
}

export function useCalendarColours(res: ResourceDefinition, actor: Actor) {
  const s = getSettings(actor.user.id);
  const opts = colourByOptions(res);
  const saved = s.calendarColors?.[res.key];
  const by = opts.find((o) => o.key === saved?.by) ?? opts[0];
  const colors = saved?.colors ?? {};
  /** the values of the chosen field, with their current colour (custom hex, or tone, or default swatch) */
  const values = (rows: RecordData[]) => {
    if (!by) return [];
    const f = by.field;
    let base: { key: string; label: string; preferred?: string }[];
    if (f.type === 'master') base = activeMasterValues(f.master!).map((v) => ({ key: v.key, label: v.label, preferred: TONE_HEX[v.tone ?? 'neutral'] }));
    else {
      const target = f.relation ? getResource(f.relation.resource) : undefined;
      const ids = [...new Set(rows.map((r) => (r[f.key] == null || r[f.key] === '' ? '' : String(r[f.key]))))].sort();
      base = ids.map((id) => ({ key: id, label: id ? (target ? recordTitle(target.key, id, actor) : id) : (res.calendar?.lanes.find((l) => l.field === f.key)?.emptyLaneLabel ?? 'None') }));
    }
    const hexes = assignUnique(base.map((b) => ({ key: b.key, saved: colors[`${by.key}:${b.key}`], preferred: b.preferred })));
    return base.map((b, i) => ({ key: b.key, label: b.label, hex: hexes[i] }));
  };
  /** colour of one event: { hex } for a chosen / default swatch, or { tone } for a master tone */
  const eventColour = (r: RecordData, all: ReturnType<typeof values>) => {
    if (!by) return {};
    const v = r[by.key] == null || r[by.key] === '' ? '' : String(r[by.key]);
    const hit = all.find((x) => x.key === v);
    if (hit?.hex) return { hex: hit.hex };
    if (by.field.type === 'master') return { tone: masterValue(by.field.master!, v)?.tone ?? 'neutral' };
    return {};
  };
  const save = (patch: { by?: string; colors?: Record<string, string> }) =>
    updateSettings(actor.user.id, { calendarColors: { ...(s.calendarColors ?? {}), [res.key]: { by: patch.by ?? by?.key ?? '', colors: patch.colors ?? colors } } });
  return { opts, by, colors, values, eventColour, save };
}

/** The palette button on the calendar line and its "Calendar colours" panel. */
export function CalendarColoursButton({ res, actor, rows }: { res: ResourceDefinition; actor: Actor; rows: RecordData[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const cc = useCalendarColours(res, actor);
  if (!cc.by) return null;
  const list = cc.values(rows);
  const PRESETS = CAL_SWATCHES.slice(0, 8);
  const owner = (hex: string, except: string) => list.find((x) => x.key !== except && x.hex.toLowerCase() === hex.toLowerCase());
  // two values never share a colour: presets used elsewhere are disabled; a custom colour that clashes swaps with its owner
  const setHex = (key: string, hex: string) => {
    const k = (x: string) => `${cc.by!.key}:${x}`;
    const next = { ...cc.colors, [k(key)]: hex };
    const clash = owner(hex, key);
    const mine = list.find((x) => x.key === key)?.hex;
    if (clash && mine) next[k(clash.key)] = mine;
    cc.save({ colors: next });
  };
  return (
    <>
      <IconButton ref={ref} icon="palette" label="Calendar colours" pressed={open} aria-haspopup="dialog" aria-expanded={open} className="tools-icon-btn" onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Calendar colours" width={380} align="end" className="calcol-pop">
        <div className="calcol-head">
          <strong>Calendar colours</strong>
          <button
            type="button"
            className="link small"
            onClick={() => cc.save({ colors: Object.fromEntries(Object.entries(cc.colors).filter(([k]) => !k.startsWith(`${cc.by!.key}:`))) })}
          >
            Reset
          </button>
        </div>
        <div className="calcol-by">
          <span className="field-label">Colour by</span>
          <SelectMenu block label="Colour events by" value={cc.by.key} options={cc.opts.map((o) => ({ value: o.key, label: o.label }))} onChange={(v) => cc.save({ by: v })} />
        </div>
        <ul className="calcol-list">
          {list.map((v) => (
            <li key={v.key || 'none'} className="calcol-row">
              <span className="calcol-dot" style={{ background: v.hex }} aria-hidden="true" />
              <span className="calcol-label">{v.label}</span>
              <span className="calcol-swatches" role="radiogroup" aria-label={`Colour for ${v.label}`}>
                {PRESETS.map((hex) => {
                  const taken = owner(hex, v.key);
                  return (
                    <button
                      key={hex}
                      type="button"
                      role="radio"
                      aria-checked={v.hex === hex}
                      aria-label={taken ? `${hex}, used by ${taken.label}` : hex}
                      data-tooltip={taken ? `Used by ${taken.label}` : undefined}
                      disabled={!!taken}
                      className={cx('calcol-swatch', v.hex === hex && 'is-on', taken && 'is-taken')}
                      style={{ background: hex }}
                      onClick={() => setHex(v.key, hex)}
                    />
                  );
                })}
                {/* any colour: the browser's colour picker behind a "+" swatch */}
                <label className={cx('calcol-swatch calcol-custom', !PRESETS.includes(v.hex) && 'is-on')} style={!PRESETS.includes(v.hex) ? { background: v.hex } : undefined} data-tooltip="Custom colour">
                  <input type="color" aria-label={`Custom colour for ${v.label}`} value={v.hex} onChange={(e) => setHex(v.key, e.target.value)} />
                </label>
              </span>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}
