/** FR-024 / FR-116 daily close: confirm a prefilled summary; open work is carried forward, never completed. */
import { hasCap } from './access';
import { type Ctx, fail, nextId } from './engine';

export function confirmDailyClose(ctx: Ctx, c: { date: string; stage: string; carried: string[]; note?: string }) {
  if (!hasCap(ctx.actor, 'stage.operate') && !hasCap(ctx.actor, 'plan.manage')) fail('forbidden', `${ctx.actor.roleLabel} cannot confirm a daily close`);
  const closes = (ctx.s.closes ??= []);
  if (closes.some((x) => x.date === c.date && x.stage === c.stage)) fail('duplicate', `Daily close for ${c.stage} on ${c.date} is already confirmed`);
  const rec = { id: nextId(ctx.s, 'CLS'), date: c.date, stage: c.stage, by: ctx.actor.id, at: ctx.at, carried: c.carried, note: c.note };
  closes.push(rec);
  return rec;
}
