import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import { formatDate, formatTime, toLocalDateTime } from '../lib/dates';
import { cx } from '../lib/format';
import { canReadResource } from '../services/authz';
import { useActor, useRevision, useSettings } from '../services/hooks';
import { getSettings, updateSettings } from '../services/settings';
import { findPalette, themeChartMix } from '../lib/palette';
import { activeMasterValues, getResource } from '../services/registry';
import { Button, IconButton } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { MultiSelectMenu } from '../components/primitives/MultiSelectMenu';
import { Popover } from '../components/primitives/overlay';
import { SelectMenu } from '../components/primitives/SelectMenu';
import { DateRangeCalendar } from '../components/primitives/DateRangeCalendar';
import { relationOptions } from '../components/resource/FormFields';
import { PageHeader } from '../components/shell/PageHeader';
import { DashLayoutProvider, useLayoutHistory } from '../components/dashboard/Layout';
import { CHART_COLOURS, CHART_GROUPS, CHART_MIXES, DEFAULT_CHART_COLOUR, darkVariant, resolveChartColour } from '../components/dashboard/chartPalette';
import { BillingTab } from './dashboard/BillingTab';
import { OverviewTab } from './dashboard/OverviewTab';
import { PatientsTab } from './dashboard/PatientsTab';
import { SchedulingTab } from './dashboard/SchedulingTab';
import { DEFAULT_FILTERS, PERIOD_CHIP, PERIOD_LABEL, TAB_LABEL, buildDashData, type DashFilters, type DashTab, type Period, type Scope } from './dashboard/model';

/**
 * Quick period chips (owner, 2026-11-24): 7 · 15 · 30 · 90 days · All on the dashboard's top line, where the section
 * tabs used to be (the sections now live in the sidebar). One tap changes the period; the rest is under +.
 */
// All first, then the day ranges short → long, then Custom (owner, 2026-11-24)
const PERIODS: Period[] = ['all', 'week', 'fortnight', 'month', 'quarter', 'custom'];
const PERIOD_ICON: Record<Period, string> = { week: 'calendar', fortnight: 'calendar', month: 'calendar', quarter: 'calendar', all: 'calendar-days', custom: 'calendar-clock' };
/**
 * The period as the app's own view tabs — exactly the list pages' look (owner, 2026-11-24): icon + label, sliding
 * underline, then the same plain "+" (passed as children). "Custom" opens a From – To picker.
 */
type SavedView = NonNullable<ReturnType<typeof getSettings>['dashboardViews']>[number];
function PeriodChips({ value, onChange, onCustom, rangeLabel, views, activeView, onView, children }: { value: Period; onChange: (p: Period) => void; onCustom: (el: HTMLElement) => void; rangeLabel: string; views: SavedView[]; activeView: string | null; onView: (id: string, el: HTMLElement) => void; children?: ReactNode }) {
  const activeKey = activeView ? `v:${activeView}` : value;
  const ref = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current?.querySelector<HTMLElement>(`[data-view-id="${activeKey}"]`);
      setInk(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    place();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeKey, views.length]);
  const pick = (p: Period, el: HTMLElement) => (p === 'custom' ? onCustom(el) : onChange(p));
  return (
    <div className="viewbar dv-period-tabs" role="navigation" aria-label="Period">
      <div className="viewbar-scroll-wrap">
        <div className="viewbar-scroll">
          <div ref={ref} className="viewbar-tabs" role="tablist" aria-label="Period">
            {ink && <span className="view-tab-ink" aria-hidden="true" style={{ transform: `translateX(${ink.left + 4}px)`, width: Math.max(0, ink.width - 8) }} />}
            {PERIODS.map((p, i) => (
              <div key={p} className={cx('view-tab', p === activeKey && 'is-active')} data-view-id={p}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={p === activeKey}
                  aria-haspopup={p === 'custom' ? 'dialog' : undefined}
                  tabIndex={p === activeKey ? 0 : -1}
                  className="view-tab-btn"
                  data-tooltip={p === activeKey ? rangeLabel : p === 'custom' ? 'Pick your own from – to dates' : PERIOD_LABEL[p]}
                  onClick={(e) => pick(p, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                    const next = PERIODS[(i + (e.key === 'ArrowRight' ? 1 : -1) + PERIODS.length) % PERIODS.length];
                    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-view-id="${next}"] button`)?.focus());
                    if (next !== 'custom') onChange(next);
                  }}
                >
                  <Icon name={PERIOD_ICON[p]} size={14} />
                  <span>{PERIOD_CHIP[p]}</span>
                </button>
              </div>
            ))}
            {/* saved views (made with +) come after the built-in periods, like the list pages */}
            {views.map((v) => {
              const key = `v:${v.id}`;
              const on = key === activeKey;
              return (
                <div key={key} className={cx('view-tab', on && 'is-active')} data-view-id={key}>
                  <button type="button" role="tab" aria-selected={on} aria-haspopup={on ? 'dialog' : undefined} tabIndex={on ? 0 : -1} className="view-tab-btn" data-tooltip={on ? `${v.name} — click to edit or delete` : v.name} onClick={(e) => onView(v.id, e.currentTarget)}>
                    <Icon name="filter" size={14} />
                    <span>{v.name}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Custom period: the date RANGE calendar (quick ranges · one calendar · Cancel · Apply) under the Custom tab */
function CustomRangePop({ anchor, from, to, onClose, onApply }: { anchor: HTMLElement | null; from?: string; to?: string; onClose: () => void; onApply: (from: string, to: string) => void }) {
  return (
    <Popover open={!!anchor} onClose={onClose} anchor={{ current: anchor }} label="Custom period" width={470} className="drp-pop" align="start">
      <DateRangeCalendar from={from} to={to} onCancel={onClose} onApply={onApply} />
    </Popover>
  );
}

const COLOUR_KEY = 'uab.dashboard.chartColour';
const readColour = (): string => {
  try {
    // ?colour=gold or ?colour=2f6b4f in the link previews a colour (handy for sharing a demo); otherwise the saved choice
    const fromLink = resolveChartColour(new URLSearchParams(window.location.search).get('colour'));
    return (fromLink ?? resolveChartColour(localStorage.getItem(COLOUR_KEY)))?.id ?? DEFAULT_CHART_COLOUR;
  } catch {
    return DEFAULT_CHART_COLOUR;
  }
};

/** Palette button on the tab line: pick the dashboard's chart colour (56 presets in 7 moods or any custom colour); saved per browser. */
function ChartColourButton({ value, onChange, themeMarks }: { value: string; onChange: (id: string) => void; themeMarks: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const withTheme = (c: ReturnType<typeof resolveChartColour>) => (c && c.id === 'theme' ? { ...c, marks: themeMarks, hex: themeMarks[0] } : c);
  const current = withTheme(resolveChartColour(value)) ?? CHART_COLOURS[0];
  const isCustom = !CHART_COLOURS.some((c) => c.id === value);
  return (
    <>
      <button ref={ref} type="button" className="dv-colour-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`Chart colour: ${current.label}`} data-tooltip="Chart colour" onClick={() => setOpen((o) => !o)}>
        <span className="dv-colour-dot" style={{ background: current.marks ? `conic-gradient(${current.marks.join(', ')})` : current.hex }} aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Chart colour" width={340} align="end">
        <div className="dv-colour-pop">
          <div className="dv-colour-group">
            <span className="dv-colour-title">Colour mixes · a different colour per chart part</span>
            <div className="dv-colour-mixes" role="radiogroup" aria-label="Colour mixes">
              {CHART_MIXES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={value === m.id} className={cx('dv-colour-mix', value === m.id && 'is-on')} onClick={() => onChange(m.id)}>
                  <span className="dv-colour-mix-dots" aria-hidden>
                    {(m.id === 'theme' ? themeMarks : m.marks!).map((c) => (
                      <span key={c} style={{ background: c }} />
                    ))}
                  </span>
                  <span>
                    <strong>{m.label}</strong>
                    <small>{m.note}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <span className="dv-colour-title">Single colour · shades of one hue</span>
          {CHART_GROUPS.map((g) => (
            <div key={g.label} className="dv-colour-group">
              <span className="dv-colour-title">{g.label}</span>
              <div className="dv-colour-grid" role="radiogroup" aria-label={`${g.label} colours`}>
                {g.colours.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={c.id === value} aria-label={c.label} className={cx('dv-colour-swatch', c.id === value && 'is-on')} onClick={() => onChange(c.id)} data-tooltip={`${c.label} · ${c.hex}`}>
                    <span style={{ background: c.hex }} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label className={cx('dv-colour-custom', isCustom && 'is-on')}>
            <input type="color" value={current.hex} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label="Custom chart colour" />
            <span>
              <strong>Custom colour</strong>
              <small>{isCustom ? current.hex : 'Pick any colour'}</small>
            </span>
          </label>
          <p className="dv-colour-now">
            Now: <strong>{current.label}</strong>
          </p>
        </div>
      </Popover>
    </>
  );
}

type Option = { value: string; label: string; avatar?: { name: string; src?: string | null } };

/**
 * "+" makes a saved dashboard VIEW (owner, 2026-11-24) — like the list pages' "Add view": a name + Period · Compare ·
 * Clinicians · Visit type; Save adds it as a tab. Opened from an active view's tab it edits that view (Delete too).
 */
function ViewEditor({ anchor, initial, onClose, onSave, onDelete, clinicianOptions, typeOptions }: { anchor: HTMLElement | null; initial: { name: string; filters: DashFilters }; onClose: () => void; onSave: (name: string, f: DashFilters) => void; onDelete?: () => void; clinicianOptions: Option[]; typeOptions: Option[] }) {
  const [name, setName] = useState(initial.name);
  const [draft, setDraft] = useState<DashFilters>(initial.filters);
  const ok = name.trim().length > 0;
  return (
    <Popover open={!!anchor} onClose={onClose} anchor={{ current: anchor }} label={onDelete ? 'Edit view' : 'New view'} width={330} className="filter-pop dash-filter-pop" align="start">
      <div className="dash-filter-body">
        <span className="field-label">View name</span>
        <input className="input" value={name} autoFocus placeholder="e.g. Dr. Osei · this month" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && onSave(name.trim(), draft)} aria-label="View name" />
        <span className="field-label">Period</span>
        <SelectMenu block label="Period" value={draft.period === 'custom' ? 'month' : draft.period} options={(['all', 'week', 'fortnight', 'month', 'quarter'] as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} onChange={(p) => setDraft({ ...draft, period: p as Period })} />
        <span className="field-label">Compare</span>
        <SelectMenu block label="Compare" value={draft.compare} options={[{ value: 'previous', label: 'vs previous period' }, { value: 'none', label: 'No comparison' }]} onChange={(c) => setDraft({ ...draft, compare: c as DashFilters['compare'] })} />
        {clinicianOptions.length > 0 && (
          <>
            <span className="field-label">Clinicians</span>
            <MultiSelectMenu block label="Clinicians" emptyLabel="All clinicians" values={draft.clinicians} options={clinicianOptions} onChange={(vs) => setDraft({ ...draft, clinicians: vs })} />
          </>
        )}
        <span className="field-label">Visit type</span>
        <MultiSelectMenu block label="Visit type" emptyLabel="All visit types" values={draft.types} options={typeOptions} onChange={(vs) => setDraft({ ...draft, types: vs })} />
      </div>
      <div className="qf-foot">
        {onDelete ? (
          <Button variant="ghost" className="qf-clear dv-view-delete" onClick={onDelete}>
            Delete view
          </Button>
        ) : (
          <Button variant="ghost" className="qf-clear" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button variant="primary" disabled={!ok} onClick={() => ok && onSave(name.trim(), draft)}>
          {onDelete ? 'Save' : 'Save view'}
        </Button>
      </div>
    </Popover>
  );
}

/**
 * Dashboard (rules 70, 73–75, 87; layout from the society-management reference): one tab per area — Overview,
 * Scheduling, Patients, Billing (each shown only with read access). The tab line carries the Me | Clinic scope and the
 * Filters popover; a quiet caption under it says what the figures cover. Every KPI and chart follows scope + filters.
 */
export function DashboardPage() {
  useRevision();
  const actor = useActor();
  const [params] = useSearchParams();
  const ownOnly = actor.role.resources.appointments?.read === 'own';
  const scope: Scope = ownOnly ? 'me' : 'clinic';
  const [filters, setFilters] = useState<DashFilters>(DEFAULT_FILTERS);
  const [customAnchor, setCustomAnchor] = useState<HTMLElement | null>(null);
  // saved dashboard views (owner, 2026-11-24): + makes one; it shows as a tab; the active view's tab edits it
  const savedViews = getSettings(actor.user.id).dashboardViews ?? [];
  const [activeView, setActiveView] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ anchor: HTMLElement; id?: string } | null>(null);
  const saveViews = (next: SavedView[]) => updateSettings(actor.user.id, { dashboardViews: next });
  const pickPeriod = (period: Period) => {
    setActiveView(null);
    setFilters({ ...DEFAULT_FILTERS, period });
  };
  const openView = (id: string, el: HTMLElement) => {
    const v = savedViews.find((x) => x.id === id);
    if (!v) return;
    if (activeView === id) return setEditor({ anchor: el, id });
    setActiveView(id);
    setFilters({ ...DEFAULT_FILTERS, ...(v.filters as DashFilters) });
  };
  const [colour, setColour] = useState<string>(readColour);
  const pickColour = (id: string) => {
    setColour(id);
    try {
      localStorage.setItem(COLOUR_KEY, id);
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  };
  // "Match theme" (default): chart colours worked out from the theme palette's accent
  const settings = useSettings();
  const themeMarks = themeChartMix(findPalette(settings.palette, settings.customPalettes).accent);
  const picked = resolveChartColour(colour) ?? CHART_COLOURS[0];
  const chart = picked.id === 'theme' ? { ...picked, marks: themeMarks, hex: themeMarks[0] } : picked;

  const d = buildDashData(actor, scope, filters);
  const tabs = useMemo(
    () =>
      (['overview', 'scheduling', 'patients', 'billing'] as DashTab[]).filter((t) => t === 'overview' || (t === 'scheduling' && d.can.appts) || (t === 'patients' && d.can.patients) || (t === 'billing' && d.financeVisible)),
    [d.can.appts, d.can.patients, d.financeVisible],
  );
  const asked = params.get('tab') as DashTab | null;
  const tab: DashTab = asked && tabs.includes(asked) ? asked : 'overview';

  // Drag-and-place cards (owner, 2026-11-24): Undo / Redo / Reset show once a card moved; Ctrl/⌘+Z, Ctrl/⌘+Shift+Z
  const layout = useLayoutHistory(tab);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { undo, redo } = layout;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const clinicianOptions: Option[] = canReadResource(actor, 'staff') ? relationOptions(actor, getResource('appointments').fields.find((f) => f.key === 'clinicianId')!, {}).map((o) => ({ value: o.id, label: o.label, avatar: o.avatar })) : [];
  const typeOptions: Option[] = activeMasterValues('appointmentType').map((t) => ({ value: t.key, label: t.label }));
  const first = actor.user.name.replace('Dr. ', '').split(' ')[0];

  // "26 Oct – 24 Nov" (the year only when the range crosses years or is not this year)
  const thisYear = d.to.slice(0, 4);
  const short = (k: string) => (k.slice(0, 4) === thisYear && d.from.slice(0, 4) === thisYear ? formatDate(k).replace(/,? \d{4}$/, '') : formatDate(k));
  const rangeText = `${short(d.from)} – ${short(d.to)}`;
  const timed = tab !== 'patients';
  const caption = [
    timed ? `${d.period} (${formatDate(d.from)} – ${formatDate(d.to)})` : 'Registry right now · trends use the chosen period',
    timed && d.compare ? `vs ${formatDate(d.prevFrom)} – ${formatDate(d.prevTo)}` : null,
    scope === 'me' ? 'My appointments' : 'Whole clinic',
    filters.clinicians.length ? `${filters.clinicians.length} clinician${filters.clinicians.length > 1 ? 's' : ''}` : null,
    filters.types.length ? `${filters.types.length} visit type${filters.types.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean);

  return (
    <div className="page dashboard dv dv-page" data-chart-mode={chart.marks ? 'multi' : 'single'} style={{
        ...(chart.marks ? Object.fromEntries([...chart.marks.map((c, i) => [`--c-mark-${i + 1}`, c]), ['--c-trend-2', chart.done ?? 'var(--c-dot-success)']]) : {}), ['--c-chart-light' as string]: chart.hex, ['--c-chart-dark' as string]: darkVariant(chart.hex) }}>
      <PageHeader title={`Good day, ${first}`} description={`${actor.role.label} dashboard · figures computed from local synthetic data, refreshed on every change.`} crumbs={[{ label: TAB_LABEL[tab] }]} />

      <div className="dv-chrome">
        <div className="view-toolbar view-tabs-row dv-tabs-row">
          {/* Sections are in the sidebar now (owner, 2026-11-24); this line sets what the figures cover */}
          <div className="dv-filter-line">
            <PeriodChips value={filters.period} onChange={pickPeriod} onCustom={setCustomAnchor} rangeLabel={rangeText} views={savedViews} activeView={activeView} onView={openView}>
              {/* the same + as the list pages' "Add view" */}
              <button type="button" className={cx('view-add', editor && !editor.id && 'is-open')} aria-label="New view" data-tooltip="New view — save a period and filters as a tab" aria-haspopup="dialog" aria-expanded={!!editor && !editor.id} onClick={(e) => setEditor({ anchor: e.currentTarget })}>
                <Icon name="plus" size={16} />
              </button>
            </PeriodChips>
            {editor && (
              <ViewEditor
                key={editor.id ?? 'new'}
                anchor={editor.anchor}
                clinicianOptions={clinicianOptions}
                typeOptions={typeOptions}
                initial={editor.id ? { name: savedViews.find((v) => v.id === editor.id)?.name ?? '', filters: { ...DEFAULT_FILTERS, ...(savedViews.find((v) => v.id === editor.id)?.filters as DashFilters) } } : { name: '', filters }}
                onClose={() => setEditor(null)}
                onDelete={
                  editor.id
                    ? () => {
                        saveViews(savedViews.filter((v) => v.id !== editor.id));
                        setActiveView(null);
                        setFilters(DEFAULT_FILTERS);
                        setEditor(null);
                      }
                    : undefined
                }
                onSave={(name, f) => {
                  if (editor.id) saveViews(savedViews.map((v) => (v.id === editor.id ? { ...v, name, filters: f } : v)));
                  else {
                    const id = `dv-${Date.now().toString(36)}`;
                    saveViews([...savedViews, { id, name, filters: f }]);
                    setActiveView(id);
                  }
                  setFilters(f);
                  setEditor(null);
                }}
              />
            )}
            {customAnchor && (
              <CustomRangePop
                anchor={customAnchor}
                from={filters.customFrom}
                to={filters.customTo}
                onClose={() => setCustomAnchor(null)}
                onApply={(customFrom, customTo) => {
                  setActiveView(null);
                  setFilters({ ...DEFAULT_FILTERS, period: 'custom', customFrom, customTo });
                  setCustomAnchor(null);
                }}
              />
            )}
          </div>
          <div className="dv-tab-tools">
            {/* what the figures cover, in words; full dates, scope, filters and Updated time on hover */}
            <span className="dv-period" data-tooltip={`${caption.join(' · ')} · Updated ${formatTime(toLocalDateTime(new Date()))}`} tabIndex={0} aria-label={`Showing ${caption.join(', ')}`}>
              <CalendarRange size={13} strokeWidth={1.7} aria-hidden />
              {rangeText}
              {timed && d.compare ? <span className="dv-period-vs">vs previous</span> : null}
            </span>
            {/* always shown; greyed out until there is something to undo / redo / reset (owner, 2026-11-24) */}
            {(
              <span className="dv-edit-tools" role="group" aria-label="Card layout">
                <IconButton icon="undo" label="Undo (Ctrl+Z)" disabled={!layout.canUndo} onClick={layout.undo} />
                <IconButton icon="redo" label="Redo (Ctrl+Shift+Z)" disabled={!layout.canRedo} onClick={layout.redo} />
                <IconButton icon="reset" label="Reset to default layout" disabled={layout.isDefault} onClick={layout.reset} />
              </span>
            )}
            <ChartColourButton value={colour} onChange={pickColour} themeMarks={themeMarks} />
          </div>
        </div>
      </div>

      <div ref={bodyRef} className="dv-body" aria-label={`${TAB_LABEL[tab]} dashboard`}>
        <DashLayoutProvider layout={layout} bodyRef={bodyRef}>
        {tab === 'overview' && <OverviewTab d={d} actor={actor} />}
        {tab === 'scheduling' && <SchedulingTab d={d} actor={actor} />}
        {tab === 'patients' && <PatientsTab d={d} actor={actor} />}
        {tab === 'billing' && <BillingTab d={d} actor={actor} />}
        </DashLayoutProvider>
      </div>
    </div>
  );
}
