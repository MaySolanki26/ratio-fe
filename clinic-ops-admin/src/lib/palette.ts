/**
 * Colour themes ("theme changer"). A palette is three user-facing colours:
 *   accent  — buttons, links, selected tabs/rows, focus ring
 *   sidebar — the context-sidebar surface: white by default in every theme (owner, 2026-11-24); dark mode uses a faint tint of it
 *   rail    — the dark/light icon rail on the far left
 *   canvas  — the soft page background behind white cards (optional; derived from the accent when missing)
 * Pick only the accent and `suggestFromAccent` fills sidebar, rail and canvas (owner, 2026-11-24).
 * Everything else (hover, subtle tints, readable text on the accent, rail icon colours) is derived,
 * and text colours are pushed until they meet WCAG AA contrast (4.5:1).
 */
export interface Palette {
  id: string;
  name: string;
  accent: string;
  sidebar: string;
  rail: string;
  /** Page background behind white cards; derived from the accent when not set */
  canvas?: string;
  custom?: boolean;
}

/** The application-wide default uses the Graphite Black palette. */
export const DEFAULT_PALETTE_ID = 'graphite';

export const PRESET_PALETTES: Palette[] = [
  { id: 'violet', name: 'Soft violet', accent: '#5b47c7', sidebar: '#ffffff', rail: '#24252d' },
  { id: 'ocean', name: 'Ocean', accent: '#1f5fd6', sidebar: '#ffffff', rail: '#1c2535' },
  { id: 'emerald', name: 'Emerald', accent: '#047857', sidebar: '#ffffff', rail: '#17231e' },
  { id: 'sunset', name: 'Sunset', accent: '#c2410c', sidebar: '#ffffff', rail: '#2a211d' },
  { id: 'rose', name: 'Rose', accent: '#be185d', sidebar: '#ffffff', rail: '#2a1e25' },
  { id: 'graphite', name: 'Graphite Black', accent: '#3f3f46', sidebar: '#ffffff', rail: '#15161a' },
  { id: 'daylight', name: 'Daylight', accent: '#5b47c7', sidebar: '#ffffff', rail: '#ececf1' },
];

const HEX = /^#([0-9a-f]{6})$/i;
export const isHex = (v: string) => HEX.test(v.trim());

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: number[]) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;

/** Mix `a` towards `b` by t (0–1). */
export function mix(a: string, b: string, t: number) {
  const A = rgb(a);
  const B = rgb(b);
  return toHex(A.map((x, i) => x + (B[i] - x) * t));
}

export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Move `fg` towards `toward` until it reaches `min` contrast against `bg`. */
function ensureContrast(fg: string, bg: string, toward: string, min = 4.5) {
  let c = fg;
  for (let i = 0; i < 20 && contrast(c, bg) < min; i++) c = mix(c, toward, 0.1);
  return c;
}

/* ---- HSL helpers (for colours worked out from the accent) ---- */
function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
function fromHsl(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Sidebar, icon rail and page background that go with an accent: near-white / near-black, tinted by the accent */
export function suggestFromAccent(accent: string): { sidebar: string; rail: string; canvas: string } {
  const a = accent.toLowerCase();
  return {
    sidebar: '#ffffff', // the sidebar is white in every theme (owner, 2026-11-24); the canvas carries the tint
    rail: mix('#0c0d11', a, 0.14),
    canvas: mix('#f8f8f9', a, 0.025), // standard light-grey canvas (≈ #f5f5f5) with a small tint of the accent (owner, 2026-11-24)
  };
}

/**
 * Six chart colours that go with an accent ("Match theme" on the dashboard): the accent first, then soft neighbours
 * around the colour wheel, all at a calm saturation / lightness so no part shouts.
 */
export function themeChartMix(accent: string): string[] {
  const [h, s] = toHsl(accent.toLowerCase());
  const sat = clamp(s, 38, 62);
  return [
    fromHsl(h, clamp(s, 45, 75), 50),
    fromHsl((h + 150) % 360, sat, 52),
    fromHsl((h + 40) % 360, sat, 62),
    fromHsl((h + 300) % 360, sat, 60),
    fromHsl((h + 200) % 360, sat, 58),
    fromHsl((h + 90) % 360, sat, 55),
  ];
}

const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#1c1c23';

export interface DerivedPalette {
  accent: string;
  accentHover: string;
  onAccent: string;
  accentTextLight: string;
  accentTextDark: string;
  sidebar: string;
  rail: string;
  railIcon: string;
  railHover: string;
  railSelectedBg: string;
  railSelectedIcon: string;
  /** Page background behind white cards */
  canvas: string;
  /** Hairline between the icon rail and the sidebar: shown for a light rail (they would blend), none for a dark one */
  railDivider: string;
  /** Contrast of the text on a primary button (accent background) — shown in the editor. */
  buttonContrast: number;
}

/** Sidebar colours that earlier versions worked out automatically (tinted); a saved palette still carrying one is white now */
const OLD_AUTO_SIDEBARS = ['#f8f8f9', '#f5f8fc', '#f4f9f7', '#fbf7f4', '#fcf6f8', '#f6f6f7', '#fafafb'];
const sidebarOf = (p: Palette) => {
  const v = p.sidebar.toLowerCase();
  return OLD_AUTO_SIDEBARS.includes(v) || v === mix('#fafafb', p.accent.toLowerCase(), 0.025) ? '#ffffff' : p.sidebar;
};

export function derivePalette(p: Palette): DerivedPalette {
  const accent = p.accent.toLowerCase();
  const onAccent = contrast('#ffffff', accent) >= 4.5 ? '#ffffff' : '#111114';
  const railLight = luminance(p.rail) > 0.4;
  const accentTextLight = ensureContrast(accent, LIGHT_SURFACE, '#000000');
  return {
    accent,
    accentHover: mix(accent, '#000000', 0.12),
    onAccent,
    accentTextLight,
    accentTextDark: ensureContrast(mix(accent, '#ffffff', 0.35), DARK_SURFACE, '#ffffff'),
    sidebar: sidebarOf(p),
    rail: p.rail,
    railIcon: ensureContrast(railLight ? mix(p.rail, '#000000', 0.55) : mix(p.rail, '#ffffff', 0.6), p.rail, railLight ? '#000000' : '#ffffff', 4.5),
    railHover: railLight ? mix(p.rail, '#000000', 0.06) : mix(p.rail, '#ffffff', 0.08),
    railSelectedBg: mix(p.rail, accent, railLight ? 0.22 : 0.35),
    railSelectedIcon: railLight ? accentTextLight : ensureContrast(mix(accent, '#ffffff', 0.6), mix(p.rail, accent, 0.35), '#ffffff', 4.5),
    canvas: p.canvas ?? suggestFromAccent(accent).canvas,
    railDivider: railLight ? 'var(--s-border)' : 'transparent',
    buttonContrast: contrast(onAccent, accent),
  };
}

const VARS: Record<keyof Omit<DerivedPalette, 'buttonContrast'>, string> = {
  accent: '--pal-accent',
  accentHover: '--pal-accent-hover',
  onAccent: '--pal-on-accent',
  accentTextLight: '--pal-accent-text-light',
  accentTextDark: '--pal-accent-text-dark',
  sidebar: '--pal-sidebar',
  rail: '--pal-rail',
  railIcon: '--pal-rail-icon',
  railHover: '--pal-rail-hover',
  railSelectedBg: '--pal-rail-selected-bg',
  railSelectedIcon: '--pal-rail-selected-icon',
  canvas: '--pal-canvas',
  railDivider: '--pal-rail-divider',
};

/** Apply the selected palette to the document, including the default palette. */
export function applyPalette(p: Palette | undefined, root: HTMLElement = document.documentElement) {
  if (!p) {
    root.removeAttribute('data-palette');
    Object.values(VARS).forEach((v) => root.style.removeProperty(v));
    return;
  }
  const d = derivePalette(p);
  root.setAttribute('data-palette', p.id);
  (Object.keys(VARS) as (keyof typeof VARS)[]).forEach((k) => root.style.setProperty(VARS[k], d[k]));
}

export function findPalette(id: string, custom: Palette[]): Palette {
  return [...PRESET_PALETTES, ...custom].find((p) => p.id === id) ?? PRESET_PALETTES.find((p) => p.id === DEFAULT_PALETTE_ID)!;
}
