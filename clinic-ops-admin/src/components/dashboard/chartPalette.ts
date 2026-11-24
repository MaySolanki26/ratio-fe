/**
 * Dashboard chart colour palette (SKILL.md rule 100e, references/design-system.md → "Dashboard colour palette").
 * A dashboard uses ONE of these as its chart hue (`--c-chart`): every chart mark and KPI icon is a shade of it
 * (100 / 66 / 44 / 28 / 18 / 11 % towards the card). Dark theme uses the hue mixed 62% with white.
 * 8 colour mixes (multi-colour; default Pastel, like the society-management reference) + 56 single-hue presets in 7 moods
 * + any custom "#rrggbb".
 */
export interface ChartColour {
  id: string;
  label: string;
  hex: string;
  /** Multi-colour mix: six colours for the chart parts in order, instead of one hue in shades */
  marks?: string[];
  /** Mix only: colour of the "done" trend series (e.g. Completed) */
  done?: string;
  /** Mix only: short description for the picker */
  note?: string;
}

/**
 * Colour mixes — a different colour for each part of a chart (funnel steps, donut / pie slices, waffle parts,
 * KPI icon tiles), in a fixed order. Pastel is the default (society-management reference).
 */
export const CHART_MIXES: ChartColour[] = [
  // Match theme: six colours worked out from the theme accent at runtime (lib/palette.ts → themeChartMix)
  { id: 'theme', label: 'Match theme', note: 'Follows your theme colour · default', hex: '#4c5fd5', marks: [], done: '#16a34a' },
  { id: 'pastel', label: 'Pastel', note: 'Soft & friendly', hex: '#4c5fd5', marks: ['#4c5fd5', '#3fa7a0', '#8d86c9', '#d9708a', '#6fa8dc', '#5cbf9b'], done: '#16a34a' },
  { id: 'ocean', label: 'Ocean', note: 'Calm & clinical', hex: '#1f6fb2', marks: ['#1f6fb2', '#2bb3c0', '#5b8def', '#7fd1c7', '#3d5a99', '#a3c4f3'], done: '#14946a' },
  { id: 'sunset', label: 'Sunset', note: 'Warm & lively', hex: '#e07a5f', marks: ['#e07a5f', '#f2a65a', '#c9567a', '#8e5ea2', '#e8b931', '#5a7d9a'], done: '#4f8a5b' },
  { id: 'garden', label: 'Garden', note: 'Natural & earthy', hex: '#4f8a5b', marks: ['#4f8a5b', '#9bbf6b', '#d9a441', '#c46a4a', '#6f9fb8', '#a68bc0'], done: '#2f6b4f' },
  { id: 'jewel', label: 'Jewel', note: 'Rich & premium', hex: '#1e4fa3', marks: ['#1e4fa3', '#0f7a55', '#b0234a', '#7b3fa6', '#c98a12', '#2fa3a0'], done: '#0f7a55' },
  { id: 'vivid', label: 'Vivid', note: 'High contrast · easiest to tell apart', hex: '#2a78d6', marks: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#7a5cc4'], done: '#1baf7a' },
  { id: 'soft-neutral', label: 'Soft neutral', note: 'Muted & elegant', hex: '#5b6b8c', marks: ['#5b6b8c', '#a39364', '#7a9a7e', '#b07d62', '#8e86c9', '#6fa59a'], done: '#5d7a3c' },
  { id: 'berry', label: 'Berry', note: 'Bold & stylish', hex: '#8a2e43', marks: ['#8a2e43', '#c4566e', '#e7a3b6', '#6b3a6e', '#b68cc4', '#4c5fd5'], done: '#2e8b6e' },
];
/** Kept for older imports: the default mix */
export const PASTEL_MIX = CHART_MIXES.find((m) => m.id === 'pastel')!;
export const PASTEL_MARKS = PASTEL_MIX.marks!;

export const CHART_GROUPS: { label: string; colours: ChartColour[] }[] = [
  {
    label: 'Muted',
    colours: [
      { id: 'sage', label: 'Sage', hex: '#7a9a7e' },
      { id: 'dusty-blue', label: 'Dusty blue', hex: '#6b8cae' },
      { id: 'mauve', label: 'Mauve', hex: '#9c7a97' },
      { id: 'clay', label: 'Clay', hex: '#b07d62' },
      { id: 'stone', label: 'Stone', hex: '#8a8178' },
      { id: 'lavender', label: 'Lavender', hex: '#8e86c9' },
      { id: 'seafoam', label: 'Seafoam', hex: '#6fa59a' },
      { id: 'heather', label: 'Heather', hex: '#8f8aa8' },
    ],
  },
  {
    label: 'Deep',
    colours: [
      { id: 'navy', label: 'Navy', hex: '#1f3a68' },
      { id: 'forest', label: 'Forest', hex: '#2f6b4f' },
      { id: 'plum', label: 'Plum', hex: '#6b3a6e' },
      { id: 'burgundy', label: 'Burgundy', hex: '#8a2e43' },
      { id: 'charcoal', label: 'Charcoal', hex: '#3d4451' },
      { id: 'petrol', label: 'Petrol', hex: '#1d5c6b' },
      { id: 'midnight', label: 'Midnight', hex: '#232f5c' },
      { id: 'espresso', label: 'Espresso', hex: '#5a3e2b' },
    ],
  },
  {
    label: 'Warm',
    colours: [
      { id: 'gold', label: 'Warm gold', hex: '#b8893b' },
      { id: 'terracotta', label: 'Terracotta', hex: '#c0613f' },
      { id: 'copper', label: 'Copper', hex: '#a8643a' },
      { id: 'coral', label: 'Coral', hex: '#e07a5f' },
      { id: 'amber', label: 'Amber', hex: '#d08a1e' },
      { id: 'rose', label: 'Rose', hex: '#c4566e' },
      { id: 'saffron', label: 'Saffron', hex: '#e0a526' },
      { id: 'brick', label: 'Brick', hex: '#a3422f' },
    ],
  },
  {
    label: 'Cool',
    colours: [
      { id: 'indigo', label: 'Indigo', hex: '#4c5fd5' },
      { id: 'blue', label: 'Blue', hex: '#2563eb' },
      { id: 'teal', label: 'Teal', hex: '#0f8b8d' },
      { id: 'cyan', label: 'Cyan', hex: '#0e9bb8' },
      { id: 'emerald', label: 'Emerald', hex: '#14946a' },
      { id: 'violet', label: 'Violet', hex: '#7c5cc4' },
      { id: 'sky', label: 'Sky', hex: '#3b9ae1' },
      { id: 'azure', label: 'Azure', hex: '#1e7fc8' },
    ],
  },
  {
    label: 'Earthy',
    colours: [
      { id: 'olive', label: 'Olive', hex: '#7d7a3a' },
      { id: 'moss', label: 'Moss', hex: '#5d7a3c' },
      { id: 'khaki', label: 'Khaki', hex: '#a39364' },
      { id: 'sand', label: 'Sand', hex: '#c2a878' },
      { id: 'rust', label: 'Rust', hex: '#b4532a' },
      { id: 'walnut', label: 'Walnut', hex: '#6e4e37' },
      { id: 'taupe', label: 'Taupe', hex: '#8b7d6b' },
      { id: 'ochre', label: 'Ochre', hex: '#c08a2c' },
    ],
  },
  {
    label: 'Jewel',
    colours: [
      { id: 'sapphire', label: 'Sapphire', hex: '#1e4fa3' },
      { id: 'malachite', label: 'Malachite', hex: '#0f7a55' },
      { id: 'ruby', label: 'Ruby', hex: '#b0234a' },
      { id: 'amethyst', label: 'Amethyst', hex: '#7b3fa6' },
      { id: 'topaz', label: 'Topaz', hex: '#c98a12' },
      { id: 'jade', label: 'Jade', hex: '#2e8b6e' },
      { id: 'garnet', label: 'Garnet', hex: '#8c1d3a' },
      { id: 'aquamarine', label: 'Aquamarine', hex: '#2fa3a0' },
    ],
  },
  {
    label: 'Neutral',
    colours: [
      { id: 'graphite', label: 'Graphite', hex: '#4a4f57' },
      { id: 'slate', label: 'Slate', hex: '#4b5b78' },
      { id: 'pewter', label: 'Pewter', hex: '#7a8290' },
      { id: 'steel', label: 'Steel', hex: '#5a7184' },
      { id: 'ink', label: 'Ink', hex: '#2b2f3a' },
      { id: 'ash', label: 'Ash', hex: '#8c8c8c' },
      { id: 'mink', label: 'Mink', hex: '#7d6e66' },
      { id: 'iron', label: 'Iron', hex: '#555b61' },
    ],
  },
];

export const CHART_COLOURS: ChartColour[] = [...CHART_MIXES, ...CHART_GROUPS.flatMap((g) => g.colours)];
export const DEFAULT_CHART_COLOUR = 'theme';
const HEX = /^#[0-9a-f]{6}$/i;

/** A preset id, or a custom "#rrggbb" / "rrggbb" → the colour; null when it is neither */
export const resolveChartColour = (v: string | null | undefined): ChartColour | null => {
  if (!v) return null;
  const preset = CHART_COLOURS.find((c) => c.id === v);
  if (preset) return preset;
  const hex = (v.startsWith('#') ? v : `#${v}`).toLowerCase();
  return HEX.test(hex) ? { id: hex, label: `Custom ${hex}`, hex } : null;
};

/** Dark-theme value of a chart hue: lifted towards white so it reads on dark cards */
export const darkVariant = (hex: string) => `color-mix(in srgb, ${hex} 62%, white)`;
