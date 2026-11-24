import { pageZoom } from './zoom';
/**
 * Smooth form re-layout when a value shows / hides other fields (owner rule 95) — a FLIP animation on just the
 * form fields (no page-wide View Transition, which flickered inside drawers):
 *  - fields that stay glide from their old position to the new one;
 *  - a field that appears fades in sliding down a little;
 *  - a field that disappears is briefly re-drawn where it was (inside the same form, so it keeps its styles)
 *    and fades out sliding up.
 */
const DURATION = 220;
const EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';

export type FieldSnapshot = Map<string, { rect: DOMRect; node: HTMLElement; parent: HTMLElement | null }>;

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function snapshotFields(root: Element | null): FieldSnapshot {
  const map: FieldSnapshot = new Map();
  root?.querySelectorAll<HTMLElement>('[data-ff]').forEach((el) => map.set(el.dataset.ff!, { rect: el.getBoundingClientRect(), node: el, parent: el.parentElement }));
  return map;
}

export function playFieldFlip(root: Element | null, before: FieldSnapshot) {
  if (!root || typeof Element.prototype.animate !== 'function') return;
  const after = snapshotFields(root);
  after.forEach(({ rect, node }, key) => {
    const old = before.get(key);
    if (old) {
      const z = pageZoom();
      const dx = (old.rect.left - rect.left) / z;
      const dy = (old.rect.top - rect.top) / z;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
        node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: DURATION, easing: EASE });
    } else {
      node.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: DURATION, easing: EASE });
    }
  });
  before.forEach(({ rect, node, parent }, key) => {
    if (after.has(key) || !parent?.isConnected) return;
    const ghost = node.cloneNode(true) as HTMLElement;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const box = parent.getBoundingClientRect();
    const z = pageZoom();
    Object.assign(ghost.style, { position: 'absolute', left: `${(rect.left - box.left) / z}px`, top: `${(rect.top - box.top) / z}px`, width: `${rect.width / z}px`, height: `${rect.height / z}px`, margin: '0', pointerEvents: 'none', zIndex: '1' });
    ghost.removeAttribute('data-ff');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('inert', '');
    parent.appendChild(ghost);
    const anim = ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: DURATION, easing: EASE, fill: 'forwards' });
    anim.onfinish = () => ghost.remove();
  });
}
