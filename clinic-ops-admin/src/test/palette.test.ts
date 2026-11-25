import { beforeEach, describe, expect, it } from 'vitest';
import { applyPalette, contrast, derivePalette, findPalette, PRESET_PALETTES, suggestFromAccent } from '../lib/palette';
import { actorFor } from '../services/authz';
import { __setDb, createDb } from '../services/db';
import { deleteCustomPalette, getSettings, saveCustomPalette } from '../services/settings';
import { useDomain } from '../domain/active';
import { clinicDomain } from '../domain/clinic/domain';

// These tests exercise the shared platform with the original clinic example pack.
useDomain(clinicDomain);

describe('theme changer', () => {
  beforeEach(() => __setDb(createDb(new Date('2026-10-16T09:00:00'))));

  it('every preset keeps text readable (AA 4.5:1) on buttons, links and the rail', () => {
    for (const p of PRESET_PALETTES) {
      const d = derivePalette(p);
      expect(contrast(d.onAccent, d.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(d.accentTextLight, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(d.railIcon, d.rail)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the Rentio Heritage preset uses the sign-in page colours', () => {
    const p = findPalette('rentio', []);
    expect(p.name).toBe('Rentio Heritage');
    const d = derivePalette(p);
    expect(d.accent).toBe('#a3162b');
    expect(d.rail).toBe('#3b1f12');
    // grey canvas with only a small tint of the maroon accent (not the sign-in page's paper beige)
    expect(d.canvas).toBe(suggestFromAccent('#a3162b').canvas);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(d.canvas.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(6);
    expect(d.onAccent).toBe('#ffffff');
  });

  it('a very light custom accent switches the button text to dark', () => {
    const d = derivePalette({ id: 'x', name: 'Lemon', accent: '#ffe066', sidebar: '#ffffff', rail: '#222222' });
    expect(d.onAccent).not.toBe('#ffffff');
    expect(contrast(d.accentTextLight, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('custom palettes are saved, applied, edited and deleted per user', () => {
    const actor = actorFor('u_morgan', 'riverside');
    const id = saveCustomPalette(actor, { name: 'Clinic teal', accent: '#0f766e', sidebar: '#f3faf9', rail: '#13201f' });
    expect(getSettings('u_morgan').palette).toBe(id);
    saveCustomPalette(actor, { id, name: 'Teal 2', accent: '#0f766e', sidebar: '#f3faf9', rail: '#13201f' });
    expect(getSettings('u_morgan').customPalettes.map((p) => p.name)).toEqual(['Teal 2']);
    deleteCustomPalette(actor, id);
    expect(getSettings('u_morgan').customPalettes).toEqual([]);
    expect(getSettings('u_morgan').palette).toBe('graphite');
  });

  it('the default Graphite Black palette applies its CSS variables', () => {
    applyPalette(findPalette('ocean', []));
    expect(document.documentElement.getAttribute('data-palette')).toBe('ocean');
    expect(document.documentElement.style.getPropertyValue('--pal-accent')).toBe('#1f5fd6');
    applyPalette(findPalette('graphite', []));
    expect(document.documentElement.getAttribute('data-palette')).toBe('graphite');
    expect(document.documentElement.style.getPropertyValue('--pal-accent')).toBe('#3f3f46');
  });
});
