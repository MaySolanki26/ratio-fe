/**
 * Test helpers for the shared custom controls (skill rules 9 / 24: no native <select> or date inputs).
 * They drive the real UI — open the dropdown / calendar and click — the way a user would.
 */
import { act, fireEvent } from '@testing-library/react';

const click = (el: Element) => act(() => void fireEvent.click(el));

function pickOption(trigger: HTMLElement, value: string) {
  if (trigger.getAttribute('data-value') === value) return;
  click(trigger);
  // a two-value dropdown switches on one click (skill rule 55c) — no list opens
  if (trigger.getAttribute('data-value') === value) return;
  const opt = document.querySelector<HTMLElement>(`[role="option"][data-value="${CSS.escape(value)}"]`);
  if (!opt) throw new Error(`No option "${value}" in ${trigger.getAttribute('aria-label') ?? 'dropdown'}`);
  click(opt);
}

/** "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD") through the DatePicker popover. */
function pickDateTime(trigger: HTMLElement, value: string) {
  click(trigger);
  const pop = document.querySelector<HTMLElement>('.date-pop')!;
  const [day, time] = value.split('T');
  let guard = 24;
  while (!pop.querySelector(`[data-day="${day}"]`) && guard--) {
    const shown = pop.querySelector<HTMLElement>('.dp-days [data-day]')!.dataset.day!;
    click(pop.querySelector(`[aria-label="${shown < day ? 'Next month' : 'Previous month'}"]`)!);
  }
  click(pop.querySelector(`[data-day="${day}"]`)!);
  if (time) {
    const [H, M] = time.split(':').map(Number);
    const [hour, minute, ampm] = [...pop.querySelectorAll<HTMLElement>('.dp-time [aria-haspopup="listbox"]')];
    pickOption(ampm, H < 12 ? 'AM' : 'PM');
    pickOption(hour, String(H % 12 || 12));
    pickOption(minute, String(M));
    click([...pop.querySelectorAll('button')].find((b) => b.textContent === 'Done')!);
  }
}

/** Set any form control: native input/textarea, custom dropdown or date picker. */
export function setField(el: HTMLElement, value: string) {
  const popup = el.getAttribute('aria-haspopup');
  if (popup === 'listbox') return pickOption(el, value);
  if (popup === 'dialog') return pickDateTime(el, value);
  fireEvent.change(el, { target: { value } });
}

/** Current value of any form control (custom triggers expose it as data-value). */
export const fieldValue = (el: HTMLElement) => el.getAttribute('data-value') ?? (el as HTMLInputElement).value;
