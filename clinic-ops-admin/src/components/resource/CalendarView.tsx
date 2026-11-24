import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RecordData, ResourceDefinition } from '../../metadata/types';
import { addDays, addMinutes, formatTime, parseLocal, todayKey } from '../../lib/dates';
import { cx } from '../../lib/format';
import { PHONE, useMedia } from '../../lib/useMedia';
import { type Actor, canReadRecord, canUpdateRecord } from '../../services/authz';
import { getDb } from '../../services/db';
import { getResource, masterValue } from '../../services/registry';
import { recordTitle, updateRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { evalCondition } from '../../services/validation';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Popover } from '../primitives/overlay';
import { StatusChip, useToast } from '../primitives/feedback';
import { DatePicker } from '../primitives/DatePicker';
import { InfoTip } from '../primitives/InfoTip';
import { CalendarColoursButton, useCalendarColours } from './CalendarColors';
import { pageZoom } from '../../lib/zoom';

const DAY_START = 7;
const DAY_END = 19;
const HOUR_PX = 80;
const INACTIVE = ['cancelled', 'no_show'];
const SNAP_MIN = 15;
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Resource-timeline day calendar driven by `resource.calendar` metadata.
 * Lanes = related records (rooms / clinicians). Click an empty slot to book.
 */
export function CalendarView({
  res,
  actor,
  rows,
  onOpen,
  onCreateAt,
  activeId,
  date: controlledDate,
  onDateChange,
  actions,
}: {
  res: ResourceDefinition;
  actor: Actor;
  rows: RecordData[];
  onOpen: (id: string) => void;
  onCreateAt?: (values: Record<string, unknown>) => void;
  activeId?: string;
  date?: string;
  onDateChange?: (d: string) => void;
  /** Page actions (e.g. New appointment) at the right end of the calendar toolbar — one row, like table pages. */
  actions?: ReactNode;
}) {
  const cal = res.calendar!;
  const [laneIdx, setLaneIdx] = useState(0);
  void setLaneIdx; // lane switch is hidden for now (owner rule 93) — kept so it can be restored
  const [localDate, setLocalDate] = useState(todayKey());
  const date = controlledDate ?? localDate;
  const setDate = onDateChange ?? setLocalDate;
  const [showInactive, setShowInactive] = useState(false);
  const phone = useMedia(PHONE);
  // Day · Week · Month (owner, 2026-11-24 — like the reference calendar) and Show weekends; remembered per resource
  const modeKey = `uab.calendar.${res.key}`;
  const [mode, setModeState] = useState<CalMode>(() => readPref(modeKey).mode ?? 'day');
  const [weekends, setWeekendsState] = useState<boolean>(() => readPref(modeKey).weekends ?? true);
  const setMode = (m: CalMode) => {
    setModeState(m);
    writePref(modeKey, { mode: m, weekends });
  };
  const setWeekends = (w: boolean) => {
    setWeekendsState(w);
    writePref(modeKey, { mode, weekends: w });
  };
  const [viewMenu, setViewMenu] = useState(false);
  const viewBtn = useRef<HTMLButtonElement>(null);
  // D / W / M switch the view (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)))) return;
      const m = ({ d: 'day', w: 'week', m: 'month' } as const)[e.key.toLowerCase() as 'd' | 'w' | 'm'];
      if (m) {
        setMode(m);
        setViewMenu(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const toast = useToast();
  // Drag to reschedule: drop on another time / lane, or on ‹ › to move it to the previous / next day (same time).
  const drag = useRef<{ id: string; grabY: number } | null>(null);
  const [ghost, setGhost] = useState<{ lane: string | null; start: string } | null>(null);
  const canMove = (r: RecordData) => {
    const raw = getDb().records[res.key]?.find((x) => x.id === r.id);
    return !!raw && canUpdateRecord(actor, res, raw) && !INACTIVE.includes(String(r.status)) && r.status !== 'completed';
  };
  const slotAt = (laneEl: HTMLElement, clientY: number, onDay = date) => {
    const y = (clientY - laneEl.getBoundingClientRect().top) / pageZoom() - (drag.current?.grabY ?? 0);
    const mins = Math.max(0, Math.min((DAY_END - DAY_START) * 60 - SNAP_MIN, Math.round(((y / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN));
    const h = DAY_START + Math.floor(mins / 60);
    return `${onDay}T${pad2(h)}:${pad2(mins % 60)}`;
  };
  const reschedule = (id: string, patch: Record<string, unknown>) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const same = Object.entries(patch).every(([k, v]) => r[k] === v);
    if (same) return;
    try {
      updateRecord(actor, res.key, id, patch, r.version);
      const when = patch[cal.startField] ? String(patch[cal.startField]) : String(r[cal.startField]);
      toast(`${id} moved to ${parseLocal(when).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatTime(when)}`, 'success');
    } catch (e) {
      toast(e instanceof ServiceError ? e.message : 'Could not move the appointment', 'danger');
    }
  };
  const dropOnDay = (delta: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const d = drag.current;
    const r = d && rows.find((x) => x.id === d.id);
    if (!r) return;
    reschedule(r.id, { [cal.startField]: `${addDays(date, delta)}${String(r[cal.startField]).slice(10)}` });
    drag.current = null;
    setGhost(null);
    setDate(addDays(date, delta));
  };
  const dayDropProps = (delta: number) => ({ onDragOver: (e: React.DragEvent) => drag.current && e.preventDefault(), onDrop: dropOnDay(delta) });
  const lane = cal.lanes[laneIdx];
  const statusKey = res.lifecycle?.field ?? 'status';
  const statusMaster = res.fields.find((f) => f.key === statusKey)?.master;
  const sv = (r: RecordData) => (statusMaster ? masterValue(statusMaster, r[statusKey]) : undefined);
  // the user's own event colours (owner rule 97)
  const cc = useCalendarColours(res, actor);
  const ccValues = cc.values(rows);
  const laneField = res.fields.find((f) => f.key === lane.field)!;
  const laneRes = getResource(laneField.relation!.resource);

  const lanes = useMemo(() => {
    let list = (getDb().records[laneRes.key] ?? []).filter((r) => canReadRecord(actor, laneRes, r));
    if (lane.laneFilter) list = list.filter((r) => evalCondition(lane.laneFilter, r));
    list = list.filter((r) => r.status !== 'inactive' && !(laneRes.key === 'rooms' && r.roomType === 'telehealth'));
    const out = list.map((r) => ({ id: r.id as string | null, label: recordTitle(laneRes.key, r.id, actor), note: r.status !== 'available' && r.status !== 'active' ? String(r.status).replace(/_/g, ' ') : '' }));
    if (lane.emptyLaneLabel) out.push({ id: null, label: lane.emptyLaneLabel, note: '' });
    return out;
  }, [laneRes, lane, actor]);

  const cancelledToday = rows.filter((r) => String(r[cal.startField]).startsWith(date) && INACTIVE.includes(String(r.status))).length;
  const dayRows = rows.filter((r) => String(r[cal.startField]).startsWith(date) && (showInactive || !INACTIVE.includes(String(r.status))));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

  const top = (start: string) => {
    const d = parseLocal(start);
    return (d.getHours() + d.getMinutes() / 60 - DAY_START) * HOUR_PX;
  };

  // Week / month ranges (Monday-first); with weekends off only Mon–Fri are shown
  const weekStart = addDays(date, -((parseLocal(date).getDay() + 6) % 7));
  const weekDays = Array.from({ length: weekends ? 7 : 5 }, (_, k) => addDays(weekStart, k));
  const step = (dir: -1 | 1) => setDate(mode === 'day' ? addDays(date, dir) : mode === 'week' ? addDays(date, 7 * dir) : shiftMonthKey(date, dir));
  const fmt = (k: string, o: Intl.DateTimeFormatOptions) => parseLocal(k).toLocaleDateString('en-US', o);
  const title =
    mode === 'day'
      ? fmt(date, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
      : mode === 'week'
        ? `${fmt(weekDays[0], { month: 'short', day: 'numeric' })} – ${fmt(weekDays[weekDays.length - 1], { month: 'short', day: 'numeric', year: 'numeric' })}`
        : fmt(date, { month: 'long', year: 'numeric' });

  // Date bar (owner, 2026-11-24 — like the reference): Today · ‹ › · range title (opens a date picker)
  const dateBar = (
    <div className="cal-nav cal-datebar">
      <button type="button" className="btn btn-secondary cal-today-btn" onClick={() => setDate(todayKey())} disabled={mode === 'day' ? date === todayKey() : mode === 'week' ? weekDays.includes(todayKey()) : date.slice(0, 7) === todayKey().slice(0, 7)}>
        Today
      </button>
      <span {...(mode === 'day' ? dayDropProps(-1) : {})}>
        <IconButton icon="chevron-left" label={mode === 'day' ? 'Previous day (drop an appointment here to move it a day earlier)' : mode === 'week' ? 'Previous week' : 'Previous month'} onClick={() => step(-1)} />
      </span>
      <span {...(mode === 'day' ? dayDropProps(1) : {})}>
        <IconButton icon="chevron-right" label={mode === 'day' ? 'Next day (drop an appointment here to move it a day later)' : mode === 'week' ? 'Next week' : 'Next month'} onClick={() => step(1)} />
      </span>
      <strong className="cal-date">{title}</strong>
      <DatePicker iconOnly label="Go to date" value={date} onChange={(v) => v && setDate(v)} clearable={false} />
      {onCreateAt && <InfoTip text="Click an empty slot to book it. Drag a booking to move it. Keys: D day · W week · M month." label="About the calendar" />}
    </div>
  );
  // Day · Week · Month menu with Show weekends (the reference's view dropdown)
  const viewSwitch = (
    <>
      <button ref={viewBtn} type="button" className={cx('btn btn-secondary cal-view-btn', viewMenu && 'is-open')} aria-haspopup="menu" aria-expanded={viewMenu} onClick={() => setViewMenu((o) => !o)}>
        <span className="btn-label">{MODE_LABEL[mode]}</span>
        <Icon name={viewMenu ? 'chevron-up' : 'chevron-down'} />
      </button>
      <Popover open={viewMenu} onClose={() => setViewMenu(false)} anchor={viewBtn} label="Calendar view" width={220} align="end" className="cal-view-pop">
        <ul className="cal-view-list" role="menu">
          {(['day', 'week', 'month'] as CalMode[]).map((m) => (
            <li key={m}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={mode === m}
                className={cx('cal-view-item', mode === m && 'is-on')}
                onClick={() => {
                  setMode(m);
                  setViewMenu(false);
                }}
              >
                <span>{MODE_LABEL[m]}</span>
                <kbd>{MODE_LABEL[m][0]}</kbd>
              </button>
            </li>
          ))}
        </ul>
        <div className="cal-view-toggle">
          <span id="cal-weekends-label">Show weekends</span>
          <label className="switch">
            <input type="checkbox" role="switch" aria-labelledby="cal-weekends-label" checked={weekends} onChange={(e) => setWeekends(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
          </label>
        </div>
      </Popover>
    </>
  );
  const laneBar = (
    <div className="cal-nav">
      {/* Rooms | Clinicians lane switch — hidden for now at the owner's request (owner rule 93); restore by un-commenting
      <div className="segmented" role="radiogroup" aria-label="Group lanes by">
        {cal.lanes.map((l, i) => (
          <button key={l.field} type="button" role="radio" aria-checked={i === laneIdx} className={cx('seg-btn', i === laneIdx && 'is-on')} onClick={() => setLaneIdx(i)}>
            {l.label}
          </button>
        ))}
      </div> */}
      <label className="check">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show cancelled
        {/* how many cancelled / no-show bookings this day has — so an empty day is obvious (owner rule 98) */}
        <span className="cal-inactive-count muted">{cancelledToday}</span>
      </label>
      <CalendarColoursButton res={res} actor={actor} rows={rows} />
      {!phone && viewSwitch}
      {actions}
    </div>
  );
  const [slots, setSlots] = useState<{ left: HTMLElement | null; right: HTMLElement | null }>({ left: null, right: null });
  useLayoutEffect(() => setSlots({ left: document.getElementById('cal-tools-left'), right: document.getElementById('cal-tools-right') }), []);
  const header =
    slots.left && slots.right ? (
      <>
        {/* everything on the RIGHT of the search line: Show cancelled · ‹ date › (owner rule 93) */}
        {createPortal(
          <>
            {dateBar}
            {laneBar}
          </>,
          slots.right,
        )}
      </>
    ) : (
      <div className="cal-toolbar">
        {dateBar}
        {laneBar}
      </div>
    );

  if (phone) {
    // Agenda fallback on phones.
    const sorted = [...dayRows].sort((a, b) => String(a[cal.startField]).localeCompare(String(b[cal.startField])));
    return (
      <div className="calendar">
        {header}
        <ul className="agenda">
          {sorted.map((r) => (
            <li key={r.id}>
              <button type="button" className="agenda-item" onClick={() => onOpen(r.id)}>
                <span className="agenda-time">{formatTime(String(r[cal.startField]))}</span>
                <span>
                  <strong>{recordTitle(res.key, r.id, actor).split(' · ')[0]}</strong>
                  <span className="muted"> · {recordTitle(laneRes.key, r[lane.field], actor) || lane.emptyLaneLabel}</span>
                </span>
                <StatusChip label={sv(r)?.label ?? ''} tone={sv(r)?.tone} />
              </button>
            </li>
          ))}
          {!sorted.length && <li className="muted agenda-empty">No bookings on this day.</li>}
        </ul>
      </div>
    );
  }

  // one booking block (week view) — same look as the day view's blocks
  const visible = (r: RecordData) => showInactive || !INACTIVE.includes(String(r.status));
  const eventBlock = (r: RecordData, col: number, cols: number) => {
    const start = String(r[cal.startField]);
    const dur = Number(r[cal.durationField]) || 30;
    const mv = sv(r);
    const ec = cc.eventColour(r, ccValues);
    const name = recordTitle(res.key, r.id, actor).split(' · ')[0];
    const startT = formatTime(start);
    const endT = formatTime(addMinutes(start, dur));
    const range = startT.slice(-2) === endT.slice(-2) ? `${startT.slice(0, -3)}–${endT}` : `${startT}–${endT}`;
    const h = Math.max(22, (dur / 60) * HOUR_PX - 2);
    const size = h < 36 ? 'is-tiny' : h < 56 ? 'is-short' : '';
    return (
      <button
        key={r.id}
        type="button"
        className={cx('cal-event', ec.hex ? 'has-ev' : `tone-${ec.tone ?? mv?.tone ?? 'neutral'}`, activeId === r.id && 'is-active', size, INACTIVE.includes(String(r.status)) && 'is-inactive', cols > 1 && 'is-overlap')}
        style={{ top: top(start), height: h, left: `calc(${(col / cols) * 100}% + 3px)`, width: `calc(${100 / cols}% - 6px)`, ...(ec.hex ? ({ '--ev': ec.hex } as React.CSSProperties) : {}) }}
        onClick={() => onOpen(r.id)}
        draggable={canMove(r)}
        onDragStart={(e) => {
          drag.current = { id: r.id, grabY: (e.clientY - e.currentTarget.getBoundingClientRect().top) / pageZoom() };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', r.id);
        }}
        onDragEnd={() => {
          drag.current = null;
          setGhost(null);
        }}
        data-tooltip={`${name}\n${range}${mv?.label ? ` · ${mv.label}` : ''}`}
        aria-label={`${recordTitle(res.key, r.id, actor)}, ${range}, ${mv?.label ?? ''}`}
      >
        <span className="cal-event-title">{name}</span>
        <span className="cal-event-time">{size === 'is-tiny' ? startT : range}</span>
        {!size && <span className="cal-event-status">{mv?.label}</span>}
      </button>
    );
  };
  const today = todayKey();

  if (mode === 'week') {
    // WEEK: a column per day (Mon–Sun, or Mon–Fri), hours down the side; click a slot to book, drag to move
    return (
      <div className="calendar">
        {header}
        <div className="cal-scroll">
          <div className="cal-grid cal-week" style={{ gridTemplateColumns: `76px repeat(${weekDays.length}, minmax(120px, 1fr))` }}>
            <div className="cal-corner" />
            {weekDays.map((d) => (
              <button key={d} type="button" className={cx('cal-day-head', d === today && 'is-today', d === date && 'is-picked')} onClick={() => { setDate(d); setMode('day'); }} data-tooltip="Open this day">
                <span className="cal-day-dow">{parseLocal(d).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
                <span className="cal-day-num">{Number(d.slice(8, 10))}</span>
              </button>
            ))}
            <div className="cal-times" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h) => (
                <span key={h} className="cal-time" style={{ top: (h - DAY_START) * HOUR_PX }}>
                  {formatTime(`${date}T${String(h).padStart(2, '0')}:00`)}
                </span>
              ))}
            </div>
            {weekDays.map((d) => {
              const items = rows.filter((r) => String(r[cal.startField]).startsWith(d) && visible(r));
              const weekend = [0, 6].includes(parseLocal(d).getDay());
              return (
                <div
                  key={d}
                  className={cx('cal-lane', d === today && 'is-today-col', weekend && 'is-weekend', ghost && ghost.lane === d && 'is-drop-target')}
                  style={{ height: hours.length * HOUR_PX }}
                  onDragOver={(e) => {
                    if (!drag.current) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const start = slotAt(e.currentTarget, e.clientY, d);
                    if (!ghost || ghost.lane !== d || ghost.start !== start) setGhost({ lane: d, start });
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setGhost((g) => (g?.lane === d ? null : g));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const dr = drag.current;
                    if (!dr) return;
                    reschedule(dr.id, { [cal.startField]: slotAt(e.currentTarget, e.clientY, d) });
                    drag.current = null;
                    setGhost(null);
                  }}
                >
                  {ghost && ghost.lane === d && drag.current && (
                    <div className="cal-ghost" style={{ top: top(ghost.start), height: Math.max(22, ((Number(rows.find((x) => x.id === drag.current!.id)?.[cal.durationField]) || 30) / 60) * HOUR_PX - 2) }} aria-hidden="true">
                      {formatTime(ghost.start)}
                    </div>
                  )}
                  {hours.flatMap((h) =>
                    [0, 30].map((m) => {
                      const start = `${d}T${pad2(h)}:${pad2(m)}`;
                      return <button key={start} type="button" className="cal-slot" style={{ top: (h - DAY_START + m / 60) * HOUR_PX, height: HOUR_PX / 2 }} aria-label={onCreateAt ? `Book ${formatTime(start)} on ${d}` : formatTime(start)} disabled={!onCreateAt} tabIndex={-1} onClick={() => onCreateAt?.({ [cal.startField]: start })} />;
                    }),
                  )}
                  {(() => {
                    // a whole clinic's week: at most 2 bookings side by side; the rest of a busy moment is a "+N" pill
                    const laid = layoutEvents(items, cal.startField, cal.durationField);
                    const MAXC = 1; // shown beside the "+N" pill when a moment has 3+ bookings
                    const hidden = new Map<string, number>();
                    const out = laid.map(({ r, col, cols }) => {
                      if (cols <= 2) return eventBlock(r, col, cols);
                      if (col < MAXC) return eventBlock(r, col, MAXC + 1);
                      const k = String(r[cal.startField]).slice(0, 13);
                      hidden.set(k, (hidden.get(k) ?? 0) + 1);
                      return null;
                    });
                    hidden.forEach((n, k) =>
                      out.push(
                        <button key={`more-${k}`} type="button" className="cal-more" style={{ top: top(`${k}:00`) + 2, left: `calc(${(MAXC / (MAXC + 1)) * 100}% + 3px)`, width: `calc(${100 / (MAXC + 1)}% - 6px)` }} onClick={() => { setDate(d); setMode('day'); }} data-tooltip={`${n} more at ${formatTime(`${k}:00`)} — open the day`}>
                          +{n}
                        </button>,
                      ),
                    );
                    return out;
                  })()}
                  {d === today && <span className="cal-now" style={{ top: Math.max(0, Math.min(hours.length * HOUR_PX, top(`${d}T${pad2(new Date().getHours())}:${pad2(new Date().getMinutes())}`))) }} aria-hidden="true" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'month') {
    // MONTH: weeks × days; each day lists its first bookings, "+N more" opens the day
    const first = `${date.slice(0, 7)}-01`;
    const gridStart = addDays(first, -((parseLocal(first).getDay() + 6) % 7));
    const all = Array.from({ length: 42 }, (_, k) => addDays(gridStart, k));
    const weeksNeeded = Math.ceil((((parseLocal(first).getDay() + 6) % 7) + new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0).getDate()) / 7);
    const cells = all.slice(0, weeksNeeded * 7).filter((d) => weekends || ![0, 6].includes(parseLocal(d).getDay()));
    const cols = weekends ? 7 : 5;
    const dows = (weekends ? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] : ['MON', 'TUE', 'WED', 'THU', 'FRI']);
    return (
      <div className="calendar">
        {header}
        <div className="cal-month" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {dows.map((w) => (
            <div key={w} className="cal-month-dow">{w}</div>
          ))}
          {cells.map((d) => {
            const items = rows.filter((r) => String(r[cal.startField]).startsWith(d) && visible(r)).sort((a, b) => String(a[cal.startField]).localeCompare(String(b[cal.startField])));
            const shown = items.slice(0, 3);
            return (
              <div key={d} className={cx('cal-month-cell', d.slice(0, 7) !== date.slice(0, 7) && 'is-outside', d === today && 'is-today')}>
                <button type="button" className="cal-month-day" onClick={() => { setDate(d); setMode('day'); }} aria-label={`Open ${fmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
                  {Number(d.slice(8, 10))}
                </button>
                {shown.map((r) => {
                  const mv = sv(r);
                  const ec = cc.eventColour(r, ccValues);
                  const name = recordTitle(res.key, r.id, actor).split(' · ')[0];
                  return (
                    <button key={r.id} type="button" className={cx('cal-month-event', ec.hex ? 'has-ev' : `tone-${ec.tone ?? mv?.tone ?? 'neutral'}`, INACTIVE.includes(String(r.status)) && 'is-inactive')} style={ec.hex ? ({ '--ev': ec.hex } as React.CSSProperties) : undefined} onClick={() => onOpen(r.id)} data-tooltip={`${name} · ${formatTime(String(r[cal.startField]))}${mv?.label ? ` · ${mv.label}` : ''}`}>
                      <span className="cal-month-time">{shortTime(String(r[cal.startField]))}</span>
                      <span className="cal-month-name">{name}</span>
                    </button>
                  );
                })}
                {items.length > 3 && (
                  <button type="button" className="cal-month-more" onClick={() => { setDate(d); setMode('day'); }}>
                    +{items.length - 3} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="calendar">
      {header}
      <div className="cal-scroll">
        <div className="cal-grid" style={{ gridTemplateColumns: `76px repeat(${lanes.length}, minmax(150px, 1fr))` }}>
          <div className="cal-corner" />
          {lanes.map((l) => (
            <div key={l.id ?? 'none'} className={cx('cal-lane-head', l.note && 'has-note')} data-tooltip={l.note ? `${l.label} — ${l.note}` : l.label}>
              <span>{l.label}</span>
              {l.note && <span className="tag tone-warning">{l.note}</span>}
            </div>
          ))}
          <div className="cal-times" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h) => (
              <span key={h} className="cal-time" style={{ top: (h - DAY_START) * HOUR_PX }}>
                {formatTime(`${date}T${String(h).padStart(2, '0')}:00`)}
              </span>
            ))}
          </div>
          {lanes.map((l) => {
            const items = dayRows.filter((r) => (r[lane.field] ?? null) === l.id);
            return (
              <div
                key={l.id ?? 'none'}
                className={cx('cal-lane', ghost && ghost.lane === l.id && 'is-drop-target')}
                style={{ height: hours.length * HOUR_PX }}
                onDragOver={(e) => {
                  if (!drag.current || l.note !== '') return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const start = slotAt(e.currentTarget, e.clientY);
                  if (!ghost || ghost.lane !== l.id || ghost.start !== start) setGhost({ lane: l.id, start });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setGhost((g) => (g?.lane === l.id ? null : g));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const d = drag.current;
                  if (!d) return;
                  const start = slotAt(e.currentTarget, e.clientY);
                  const patch: Record<string, unknown> = { [cal.startField]: start };
                  if (l.id) patch[lane.field] = l.id;
                  reschedule(d.id, patch);
                  drag.current = null;
                  setGhost(null);
                }}
              >
                {ghost && ghost.lane === l.id && drag.current && (
                  <div className="cal-ghost" style={{ top: top(ghost.start), height: Math.max(22, ((Number(rows.find((x) => x.id === drag.current!.id)?.[cal.durationField]) || 30) / 60) * HOUR_PX - 2) }} aria-hidden="true">
                    {formatTime(ghost.start)}
                  </div>
                )}
                {hours.flatMap((h) =>
                  [0, 30].map((m) => {
                    const start = `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                    return (
                      <button
                        key={start}
                        type="button"
                        className="cal-slot"
                        style={{ top: (h - DAY_START + m / 60) * HOUR_PX, height: HOUR_PX / 2 }}
                        aria-label={onCreateAt ? `Book ${l.label} at ${formatTime(start)}` : `${l.label} ${formatTime(start)}`}
                        disabled={!onCreateAt || l.note !== ''}
                        tabIndex={-1}
                        onClick={() => onCreateAt?.({ [cal.startField]: start, ...(l.id ? { [lane.field]: l.id } : lane.field === 'roomId' ? { visitMode: 'telehealth' } : {}) })}
                      />
                    );
                  }),
                )}
                {layoutEvents(items, cal.startField, cal.durationField).map(({ r, col, cols }) => {
                  const start = String(r[cal.startField]);
                  const dur = Number(r[cal.durationField]) || 30;
                  const overlapping = cols > 1;
                  const mv = sv(r);
                  const ec = cc.eventColour(r, ccValues);
                  const name = recordTitle(res.key, r.id, actor).split(' · ')[0];
                  const endT = formatTime(addMinutes(start, dur));
                  const startT = formatTime(start);
                  // "08:30–09:30 AM" when both share AM/PM — short enough to never be cut
                  const range = startT.slice(-2) === endT.slice(-2) ? `${startT.slice(0, -3)}–${endT}` : `${startT}–${endT}`;
                  const h = Math.max(22, (dur / 60) * HOUR_PX - 2);
                  // Content adapts to the block height so text is never cut: 1 line → 2 lines → 3 lines.
                  const size = h < 36 ? 'is-tiny' : h < 56 ? 'is-short' : '';
                  return (
                    <button
                      key={r.id}
                      type="button"
                       className={cx('cal-event', ec.hex ? 'has-ev' : `tone-${ec.tone ?? mv?.tone ?? 'neutral'}`, activeId === r.id && 'is-active', size, INACTIVE.includes(String(r.status)) && 'is-inactive', overlapping && 'is-overlap')}
                      style={{ top: top(start), height: h, left: `calc(${(col / cols) * 100}% + 4px)`, width: `calc(${100 / cols}% - 8px)`, ...(ec.hex ? ({ '--ev': ec.hex } as React.CSSProperties) : {}) }}
                      onClick={() => onOpen(r.id)}
                      draggable={canMove(r)}
                      onDragStart={(e) => {
                        drag.current = { id: r.id, grabY: (e.clientY - e.currentTarget.getBoundingClientRect().top) / pageZoom() };
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', r.id);
                      }}
                      onDragEnd={() => {
                        drag.current = null;
                        setGhost(null);
                      }}
                      data-tooltip={`${name}\n${range}${mv?.label ? ` · ${mv.label}` : ''}${overlapping ? '\nOverlaps another booking' : ''}`}
                      aria-label={`${recordTitle(res.key, r.id, actor)}, ${dur} minutes, ${mv?.label ?? ''}${overlapping ? ', overlaps another booking' : ''}`}
                    >
                      <span className="cal-event-title">{name}</span>
                      <span className="cal-event-time">{size === 'is-tiny' ? startT : range}</span>
                      {!size && <span className="cal-event-status">{mv?.label}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Overlapping bookings sit side by side (like Google/Outlook day view) instead of covering each other.
 * Greedy column assignment per overlap cluster.
 */
export function layoutEvents(items: RecordData[], startField: string, durField: string) {
  const end = (r: RecordData) => addMinutes(String(r[startField]), Number(r[durField]) || 30);
  const sorted = [...items].sort((a, b) => String(a[startField]).localeCompare(String(b[startField])) || end(b).localeCompare(end(a)));
  const out: { r: RecordData; col: number; cols: number }[] = [];
  let cluster: { r: RecordData; col: number; cols: number }[] = [];
  let colEnds: string[] = [];
  let clusterEnd = '';
  const flush = () => {
    cluster.forEach((c) => (c.cols = colEnds.length));
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const r of sorted) {
    const s = String(r[startField]);
    if (cluster.length && s >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end(r));
    } else colEnds[col] = end(r);
    cluster.push({ r, col, cols: 1 });
    if (cluster.length === 1 || end(r) > clusterEnd) clusterEnd = end(r);
  }
  if (cluster.length) flush();
  return out;
}

type CalMode = 'day' | 'week' | 'month';
const MODE_LABEL: Record<CalMode, string> = { day: 'Day', week: 'Week', month: 'Month' };
const readPref = (key: string): { mode?: CalMode; weekends?: boolean } => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
  } catch {
    return {};
  }
};
const writePref = (key: string, v: { mode: CalMode; weekends: boolean }) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
};
/** Same day number one month earlier / later (clamped to the month's last day) */
const shiftMonthKey = (key: string, by: number) => {
  const [y, m, d] = key.split('-').map(Number);
  const last = new Date(y, m - 1 + by + 1, 0).getDate();
  const t = new Date(y, m - 1 + by, Math.min(d, last));
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};
/** "8:30a" / "1:15p" — short enough for a month cell */
const shortTime = (iso: string) => formatTime(iso).replace(/^0/, '').replace(' AM', 'a').replace(' PM', 'p');
