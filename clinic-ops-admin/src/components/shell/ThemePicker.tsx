import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../lib/format';
import { derivePalette, findPalette, isHex, type Palette, PRESET_PALETTES, suggestFromAccent, themeChartMix } from '../../lib/palette';
import { useActor, useRevision } from '../../services/hooks';
import { deleteCustomPalette, getSettings, saveCustomPalette, updateSettings } from '../../services/settings';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { InfoTip } from '../primitives/InfoTip';
import { confirmDelete, FormDialog } from '../primitives/overlay';
import { useToast } from '../primitives/feedback';

/** Small mock of the app in a palette's colours: rail · sidebar · content with an accent button. */
function PaletteMock({ p, large }: { p: Palette; large?: boolean }) {
  const d = derivePalette(p);
  return (
    <span className={cx('pal-mock', large && 'is-large')} aria-hidden="true">
      <span className="pal-mock-rail" style={{ background: d.rail }}>
        <span style={{ background: d.railSelectedBg }} />
      </span>
      <span className="pal-mock-side" style={{ background: d.sidebar }}>
        <span style={{ background: `color-mix(in srgb, ${d.accent} 15%, #ffffff)` }} />
        <span />
        <span />
      </span>
      <span className="pal-mock-main" style={{ background: d.canvas }}>
        <span className="pal-mock-tab" style={{ borderColor: d.accent }} />
        <span className="pal-mock-line" />
        <span className="pal-mock-line short" />
        <span className="pal-mock-btn" style={{ background: d.accent, color: d.onAccent }}>
          {large ? 'Button' : ''}
        </span>
      </span>
    </span>
  );
}

/**
 * Theme changer (shared): light / dark / system mode + colour palettes. Presets are fixed; users can
 * create, edit and delete their own palettes (saved per user). Used in the top bar popover and Settings.
 */
export function ThemePicker({ onEditPalette, showMode = true }: { onEditPalette?: (p: Palette) => void; /** Settings shows Mode in its own one-line row (owner rule 77). */ showMode?: boolean } = {}) {
  useRevision();
  const actor = useActor();
  const toast = useToast();
  const s = getSettings(actor.user.id);
  const current = findPalette(s.palette, s.customPalettes);
  // at most TWO rows of palette cards are visible; more palettes scroll inside the grid (owner rule 88)
  const palGrid = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const g = palGrid.current;
    if (!g) return;
    const fit = () => {
      const first = g.querySelector<HTMLElement>('.pal-item');
      if (!first) return;
      const gap = parseFloat(getComputedStyle(g).rowGap) || 0;
      g.style.maxHeight = `${Math.ceil(first.offsetHeight * 2 + gap) + 4}px`; // +4 keeps the selected card's ring visible
    };
    fit();
    // the selected palette is always in view (scrolls only the grid, never the page)
    const on = g.querySelector<HTMLElement>('.pal-card.is-on')?.closest<HTMLElement>('.pal-item');
    if (on && (on.offsetTop < g.scrollTop || on.offsetTop + on.offsetHeight > g.scrollTop + g.clientHeight)) g.scrollTop = on.offsetTop - 2;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(g);
    return () => ro.disconnect();
  }, [s.customPalettes.length]);
  const [localEditing, setLocalEditing] = useState<Palette | null>(null);
  // Inside a popover the editor must be opened by the owner (a dialog click would close the popover first).
  const setEditing = (p: Palette) => (onEditPalette ? onEditPalette(p) : setLocalEditing(p));

  const card = (p: Palette) => (
    <li key={p.id} className="pal-item">
      <button type="button" role="radio" aria-checked={current.id === p.id} className={cx('pal-card', current.id === p.id && 'is-on')} onClick={() => updateSettings(actor.user.id, { palette: p.id })}>
        <PaletteMock p={p} />
        <span className="pal-name">
          {p.name}
          {current.id === p.id && <Icon name="check" size={14} />}
        </span>
      </button>
      {p.custom && (
        <span className="pal-tools">
          <IconButton icon="pencil" label={`Edit ${p.name}`} onClick={() => setEditing(p)} />
          <IconButton
            icon="trash"
            label={`Delete ${p.name}`}
            onClick={() =>
              confirmDelete({
                title: `Delete palette "${p.name}"?`,
                message: 'The palette is removed from your themes. If it is in use, the app switches back to Graphite.',
                confirmLabel: 'Delete palette',
                onConfirm: () => {
                  deleteCustomPalette(actor, p.id);
                  toast(`Palette "${p.name}" deleted`);
                },
              })
            }
          />
        </span>
      )}
    </li>
  );

  return (
    <div className="theme-picker">
      {showMode && (
      <div className="form-field">
        <span className="field-label">Mode</span>
        <div className="segmented" role="radiogroup" aria-label="Colour mode">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={s.theme === t} className={cx('seg-btn', s.theme === t && 'is-on')} onClick={() => updateSettings(actor.user.id, { theme: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      )}
      <div className="form-field">
        <span className="field-label-row">
          <span className="field-label">Colour palette</span>
          <InfoTip text="Ready-made colour combinations, or create your own. A palette sets the accent (buttons, links, selection), the sidebar and the icon rail. Text on the accent is kept readable automatically." label="About colour palettes" />
          <span className="spacer" />
          {/* "Create palette" sits on the label line so the palette cards fill whole rows (owner rule 86) */}
          <Button variant="ghost" icon="plus" className="pal-create-btn" onClick={() => setEditing({ id: '', name: '', accent: current.accent, sidebar: current.sidebar, rail: current.rail, custom: true })}>
            Create palette
          </Button>
        </span>
        <ul ref={palGrid} className="pal-grid" role="radiogroup" aria-label="Colour palette">
          {PRESET_PALETTES.map(card)}
          {s.customPalettes.map((p) => card({ ...p, custom: true }))}
        </ul>
      </div>
      {localEditing && <PaletteEditor initial={localEditing} onClose={() => setLocalEditing(null)} />}
    </div>
  );
}

function ColorField({ id, label, value, onChange, auto, onAuto }: { id: string; label: string; value: string; onChange: (v: string) => void; /** true = this colour follows the accent */ auto?: boolean; /** reset to the colour worked out from the accent */ onAuto?: () => void }) {
  const [text, setText] = useState(value);
  // the value can change from outside (worked out from the accent) — keep the text box in step
  useEffect(() => setText(value), [value]);
  const valid = isHex(text);
  return (
    <div className="form-field">
      <label className="field-label pal-field-label" htmlFor={id}>
        {label}
        {auto !== undefined &&
          (auto ? (
            <span className="pal-auto" data-tooltip="Worked out from the accent — change it to set your own">Auto</span>
          ) : (
            <button type="button" className="pal-auto-reset" onClick={onAuto} data-tooltip="Go back to the colour worked out from the accent">
              Reset to auto
            </button>
          ))}
      </label>
      <span className={cx('color-field', !valid && 'is-invalid')}>
        <input
          type="color"
          className="color-swatch"
          aria-label={`${label} picker`}
          value={value}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
        />
        <input
          id={id}
          className="input"
          placeholder="#5b47c7"
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid || undefined}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setText(v);
            if (isHex(v)) onChange(v.toLowerCase());
          }}
        />
      </span>
      {!valid && <span className="field-error">Use a 6-digit hex colour, e.g. #5b47c7</span>}
    </div>
  );
}

/** Create / edit a custom palette with a live preview. */
export function PaletteEditor({ initial, onClose }: { initial: Palette; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  // A new palette starts with only the accent chosen; sidebar, rail and page background follow it until edited
  const [p, setP] = useState<Palette>(() => (initial.id ? { ...initial, canvas: initial.canvas ?? suggestFromAccent(initial.accent).canvas } : { ...initial, ...suggestFromAccent(initial.accent) }));
  const [auto, setAuto] = useState(() => {
    const sug = suggestFromAccent(initial.accent);
    return { sidebar: !initial.id || initial.sidebar === sug.sidebar, rail: !initial.id || initial.rail === sug.rail, canvas: !initial.id || !initial.canvas || initial.canvas === sug.canvas };
  });
  const setAccent = (accent: string) => {
    const sug = suggestFromAccent(accent);
    setP((cur) => ({ ...cur, accent, ...(auto.sidebar ? { sidebar: sug.sidebar } : {}), ...(auto.rail ? { rail: sug.rail } : {}), ...(auto.canvas ? { canvas: sug.canvas } : {}) }));
  };
  const setOwn = (key: 'sidebar' | 'rail' | 'canvas', v: string) => {
    setAuto((a) => ({ ...a, [key]: false }));
    setP((cur) => ({ ...cur, [key]: v }));
  };
  const resetAuto = (key: 'sidebar' | 'rail' | 'canvas') => {
    setAuto((a) => ({ ...a, [key]: true }));
    setP((cur) => ({ ...cur, [key]: suggestFromAccent(cur.accent)[key] }));
  };
  const d = derivePalette(p);
  const isNew = !initial.id;
  const nameError = !p.name.trim() ? 'Give the palette a name' : undefined;
  const [tried, setTried] = useState(false);
  const save = () => {
    setTried(true);
    if (nameError) return;
    saveCustomPalette(actor, { id: initial.id || undefined, name: p.name, accent: p.accent, sidebar: p.sidebar, rail: p.rail, canvas: p.canvas });
    toast(isNew ? `Palette "${p.name.trim()}" created and applied` : `Palette "${p.name.trim()}" updated`);
    onClose();
  };
  return (
    <FormDialog
      fieldCount={5}
      open
      onClose={onClose}
      title={isNew ? 'Create palette' : `Edit ${initial.name}`}
      description="Pick an accent — the sidebar, icon rail, page background and dashboard chart colours follow it automatically. Change any of them to set your own."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {isNew ? 'Save palette' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="pal-editor">
        <div className="form-grid">
          <div className={cx('form-field span-2', tried && nameError && 'has-error')}>
            <label className="field-label" htmlFor="pal-name">
              Name <span className="req">*</span>
            </label>
            <input id="pal-name" className="input" value={p.name} maxLength={30} placeholder="e.g. Clinic teal" onChange={(e) => setP({ ...p, name: e.target.value })} data-autofocus aria-invalid={(tried && !!nameError) || undefined} />
            {tried && nameError && <span className="field-error">{nameError}</span>}
          </div>
          <ColorField id="pal-accent" label="Accent" value={p.accent} onChange={setAccent} />
          <ColorField id="pal-sidebar" label="Sidebar" value={p.sidebar} onChange={(v) => setOwn('sidebar', v)} auto={auto.sidebar} onAuto={() => resetAuto('sidebar')} />
          <ColorField id="pal-rail" label="Icon rail" value={p.rail} onChange={(v) => setOwn('rail', v)} auto={auto.rail} onAuto={() => resetAuto('rail')} />
          <ColorField id="pal-canvas" label="Page background" value={p.canvas ?? d.canvas} onChange={(v) => setOwn('canvas', v)} auto={auto.canvas} onAuto={() => resetAuto('canvas')} />
        </div>
        <div className="pal-preview">
          <span className="field-label">Preview</span>
          <PaletteMock p={p} large />
          <span className="pal-chart-mix" data-tooltip="Dashboard chart colours (Match theme)">
            Charts
            {themeChartMix(p.accent).map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
          <p className="pal-check">
            <Icon name={d.buttonContrast >= 4.5 ? 'check' : 'alert'} size={14} />
            Button text: {d.onAccent === '#ffffff' ? 'white' : 'dark'} · contrast {d.buttonContrast.toFixed(1)}:1
          </p>
        </div>
      </div>
    </FormDialog>
  );
}
