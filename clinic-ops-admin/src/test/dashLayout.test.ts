import { describe, expect, it } from 'vitest';
import { placeCard } from '../components/dashboard/Layout';

// Overview: [Funnel 6 | Status 4] / [Trend 6 | Attention 4] / [Overdue 10]
const span = { F: 6, S: 4, T: 6, A: 4, O: 10, H1: 5, H2: 5 };
const rows = [['F', 'S'], ['T', 'A'], ['O']];
const width = (r: string[]) => r.reduce((w, t) => w + span[t as keyof typeof span], 0);

describe('placeCard — cards never change size', () => {
  it('same row: the two swap sides', () => {
    expect(placeCard(rows, span, 'A', 'T')).toEqual([['F', 'S'], ['A', 'T'], ['O']]);
  });
  it('another row: trades with the same-width card and takes the dropped-on spot', () => {
    expect(placeCard(rows, span, 'A', 'F')).toEqual([['A', 'F'], ['T', 'S'], ['O']]);
    expect(placeCard(rows, span, 'A', 'S')).toEqual([['F', 'A'], ['T', 'S'], ['O']]);
  });
  it('no same-width card there: the rows swap', () => {
    expect(placeCard(rows, span, 'O', 'F')).toEqual([['O'], ['T', 'A'], ['F', 'S']]);
    expect(placeCard([['H1', 'H2'], ['F', 'S']], span, 'H1', 'S')).toEqual([['F', 'S'], ['H1', 'H2']]);
  });
  it('every row stays full (10 columns)', () => {
    for (const a of ['F', 'S', 'T', 'A', 'O']) for (const b of ['F', 'S', 'T', 'A', 'O']) placeCard(rows, span, a, b).forEach((r) => expect(width(r)).toBe(10));
  });
});
