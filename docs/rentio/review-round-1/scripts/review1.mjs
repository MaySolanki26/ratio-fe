// Review round 1 live verification — isolated Chrome profile, DevTools protocol.
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = '/Users/maysolanki/Documents/Rantio/rantio-fe/docs/rentio/review-round-1/screenshots/';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:5173';
const WS = '/o/rentio/w/plant1';
const VP = { desktop: [1440, 900], laptop: [1280, 720], phone: [390, 844] };

const tgt = await (await fetch('http://127.0.0.1:9444/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.enable');
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
let vp = 'desktop';
const setVp = async (name) => {
  vp = name;
  const [w, h] = VP[name];
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: name === 'phone' });
};
const go = async (path) => { await send('Page.navigate', { url: BASE + path }); await sleep(1100); };
let n = 0;
const shots = [];
const shot = async (role, dataset, screen, full = false) => {
  const name = `${String(++n).padStart(2, '0')}-${role}-${vp}-${dataset}-${screen}.png`;
  let clip;
  if (full) {
    const h = await ev('document.documentElement.scrollHeight');
    clip = { x: 0, y: 0, width: VP[vp][0], height: Math.min(h, 3000), scale: 1 };
  }
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  writeFileSync(OUT + name, Buffer.from(r.result.data, 'base64'));
  shots.push(name);
};
const asUser = (u) => ev(`(() => { const k='rentio.erp.db.v1'; const d=JSON.parse(localStorage.getItem(k)); d.session.userId='${u}'; localStorage.setItem(k, JSON.stringify(d)); return 'ok'; })()`);
const main = () => ev('document.querySelector("main")?.innerText ?? ""');
const toasts = () => ev(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')`);
const clickIn = (sel, text) => ev(`(() => { const root=document.querySelector(${JSON.stringify(sel)}); if(!root) return 'no root'; const b=[...root.querySelectorAll('button,a')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)}) && !x.disabled); if(!b) return 'missing'; b.click(); return 'ok'; })()`);
const clickBtn = (text) => clickIn('body', text);
const setInput = (sel, v) => ev(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 'no ${sel}'; const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(String(v))}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; })()`);
const dialogText = () => ev(`[...document.querySelectorAll('.drawer,.dialog')].map(d=>d.innerText).join(' || ')`);
const submit = (label) => ev(`(() => { const b=[...document.querySelectorAll('.drawer button,.dialog button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); if(!b) return 'no submit ${label}'; b.click(); return 'ok'; })()`);
const db = () => ev(`JSON.parse(localStorage.getItem('rentio.erp.db.v1'))`);
const log = [];
const check = (name, ok, detail = '') => log.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });

// ---------------------------------------------------------------- A. demo snapshot (fresh isolated profile)
await setVp('desktop');
await go('/');
await go('/');
const d0 = await db();
check('fresh isolated profile seeds the demo snapshot', d0?.rentio?.dataset === 'demo', d0?.rentio?.dataset);
await asUser('u_owner');
for (const v of ['desktop', 'laptop', 'phone']) {
  await setVp(v);
  await go(`${WS}/dashboard`);
  await shot('owner', 'demo', 'owner-overview', v !== 'phone');
}
await setVp('laptop');
await go(`${WS}/dashboard`);
const ov = await main();
check('owner overview leads with decisions', ov.indexOf('Needs your decision') >= 0 && ov.indexOf('Needs your decision') < ov.indexOf('Raw toor'), ov.slice(0, 200));
check('owner overview has no requirement codes in normal copy', !/\b(FR|BR|EC|OQ)-\d{2,3}\b/.test(ov.replace(/Implementation details[\s\S]*/, '')));
check('stock flow strip Raw → Processing → Finished → Transit → Distributors', /Raw toor[\s\S]*In processing[\s\S]*Finished \(factory\)[\s\S]*On the road[\s\S]*At distributors/.test(ov));
// exact source from a decision
check('decision action opens exact record', (await clickIn('main', 'Decide')) === 'ok');
await sleep(900);
const focused = await ev(`document.querySelector('tr.is-focus')?.innerText ?? ''`);
check('approvals page highlights the decided record', /SO-0003|credit|D04|exposure/i.test(focused), focused);
await shot('owner', 'demo', 'decision-exact-source');

// factory head: stage board + ETA
await asUser('u_fhead');
await setVp('laptop');
await go(`${WS}/production/stages`);
const sb = await main();
check('delayed run shows "ETA needs update" (no fake forecast)', sb.includes('ETA needs update'), '');
await shot('factory-head', 'demo', 'stage-board-eta-needed');
// Suresh revises ETA from his stage
await asUser('u_suresh');
await go(`${WS}/production/stage?stage=CLEAN`);
await shot('stage-owner-suresh', 'demo', 'stage-cleaning-late');
check('open ETA form', (await clickIn('.rt-next', 'Update ETA')) === 'ok');
await sleep(300);
await setInput('#rf-reason', 'Destoner jammed — 2 h to clear (demo)');
await submit('Save new ETA');
await sleep(500);
const afterEta = await main();
check('named ETA revision shown', /revised by Suresh Yadav/.test(afterEta), (await toasts()));

// manual staff handover — Anil, phone then desktop
await asUser('u_anil');
await setVp('phone');
await go(`${WS}/home/my-work`);
const mw = await main();
check('worker lands on My work with one next action: Receive RT-003/G1', /Next action[\s\S]*Receive RT-003\/G1/.test(mw), mw.slice(0, 200));
await shot('stage-owner-anil', 'demo', 'mywork-next-receive');
await clickIn('.rt-next', 'Receive');
await sleep(400);
const rcv = await dialogText();
check('receipt form shows issued / already received / outstanding / receive now / remaining', ['Originally issued', 'Already received', 'Outstanding', 'Receive now', 'Left outstanding after this'].every((x) => rcv.includes(x)), rcv.slice(0, 300));
await setInput('#rcv-qty', '3000');
await sleep(200);
await submit('Confirm receipt');
await sleep(400);
const err = await dialogText();
const kept = await ev(`document.querySelector('#rcv-qty')?.value`);
check('over-receipt refused, input preserved', /Not posted — nothing changed/.test(err) && kept === '3000', `kept=${kept}`);
await shot('stage-owner-anil', 'demo', 'receive-error-preserved');
await setInput('#rcv-qty', '2970');
await sleep(150);
await submit('Confirm receipt');
await sleep(600);
check('receipt posted', /Received 2,970 kg/.test(await toasts()), await toasts());
await setVp('desktop');
await go(`${WS}/home/my-work`);
check('next action is Start', (await clickIn('.rt-next', 'Start')) === 'ok');
await sleep(300);
await submit('Start run');
await sleep(600);
await go(`${WS}/home/my-work`);
check('next action is Record output', (await clickIn('.rt-next', 'Record output')) === 'ok');
await sleep(400);
await setInput('#o-fwd1', '2976');
await setInput('#o-oil', '6');
await sleep(200);
const bal = await dialogText();
check('output preview balanced', /Balanced ✓/.test(bal), '');
await shot('stage-owner-anil', 'demo', 'output-balanced-preview');
await submit('Post balanced output');
await sleep(600);
check('output posted', /Output posted/.test(await toasts()), await toasts());
await go(`${WS}/home/my-work`);
check('next action is Issue', (await clickIn('.rt-next', 'Issue')) === 'ok');
await sleep(300);
await submit('Issue');
await sleep(600);
check('issued onward', /Issued to COND/.test(await toasts()), await toasts());
await go(`${WS}/home/my-work`);
const mw2 = await main();
check('conditioning receipt now waiting (handover continues)', /Receive RT-003\/OIL/.test(mw2), mw2.slice(0, 160));
await shot('stage-owner-anil', 'demo', 'mywork-after-manual-cycle');
const dm = await db();
const oil = dm.rentio.movements.filter((m) => m.lotId === 'OIL-B01' && m.kind === 'addition').reduce((a, m) => a + m.qty, 0);
check('oil stores reduced by RT-001 20 kg + RT-003 6 kg', oil === 26000, oil);

// keyboard path: real Tab presses to the next action, Enter opens, focus inside, Esc closes, focus returns
{
  const key = async (k, code, vk, text) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
  await asUser('u_suresh');
  await setVp('laptop');
  await go(`${WS}/home/my-work`);
  const target = 'document.querySelector(".rt-next button, .rt-next a")';
  let t = 0;
  for (; t < 60; t++) { await key('Tab', 'Tab', 9); if (await ev(`document.activeElement === ${target}`)) break; }
  await key('Enter', 'Enter', 13, '\r');
  await sleep(500);
  const inside = await ev(`!!document.activeElement.closest('[role="dialog"]')`);
  await key('Escape', 'Escape', 27);
  await sleep(500);
  const back = await ev(`document.activeElement === ${target}`);
  check('keyboard: Tab reaches next action, Enter opens with focus inside, Esc closes and returns focus', t < 60 && inside && back, `tabs=${t + 1} inside=${inside} back=${back}`);
  await asUser('u_anil');
}

// godown & QC
await asUser('u_ravi');
await go(`${WS}/stock/godowns?focus=F1`);
const gd = await main();
check('godown shows stacks reconciled to F1 total', /sum of stacks/i.test(gd), '');
await shot('godown-ravi', 'demo', 'godown-stacks', true);
await go(`${WS}/stock/inventory`);
await setInput('input[type=search]', 'A1');
await sleep(400);
const inv = await main();
check('inventory search works and shows no distributor stock for godown', /A1/.test(inv) && !/DIST:D0|D01 stock|D02 stock/.test(inv), '');
await shot('godown-ravi', 'demo', 'inventory-search-A1');
await asUser('u_meera');
await go(`${WS}/stock/holds`);
await shot('qc-meera', 'demo', 'holds');
await go(`${WS}/home/my-work`);
await shot('qc-meera', 'demo', 'mywork');

// distributors D01 / D02 and scope leak attempts
await asUser('u_dinesh');
await setVp('phone');
await go(`${WS}/distribution/distributors`);
await shot('distributor-D01', 'demo', 'own-stock');
await setVp('desktop');
await go(`${WS}/distribution/distributors?d=D02`);
const leak1 = await main();
check('D01 cannot open D02 via ?d=D02', /not in your area/.test(leak1) && !/Konkan|475 kg/.test(leak1), leak1.slice(0, 200));
await go(`${WS}/stock/inventory`);
check('D01 blocked from Inventory by URL', /No access to this page/.test(await main()));
await go(`${WS}/stock/godowns`);
check('D01 blocked from Godowns by URL', /No access to this page/.test(await main()));
await shot('distributor-D01', 'demo', 'inventory-url-blocked');
await go(`${WS}/home/alerts`);
const al = await main();
check('D01 alerts contain nothing about D02', !/D02|Konkan/.test(al), '');
await asUser('u_farah');
await go(`${WS}/distribution/distributors`);
const d2 = await main();
check('D02 sees its own short receipt, not D01', /D02/.test(d2) && !/Shree Ganesh/.test(d2), '');
await shot('distributor-D02', 'demo', 'own-stock');

// salesman, accounts, HR, admin
await asUser('u_rohit');
await setVp('phone');
await go(`${WS}/sales/salesman`);
await shot('salesman', 'demo', 'salesman-app');
await setVp('laptop');
await asUser('u_neha');
await go(`${WS}/finance/tally`);
await shot('accounts', 'demo', 'tally');
await go(`${WS}/finance/close`);
await shot('accounts', 'demo', 'period-close-audit');
await asUser('u_pooja');
await go(`${WS}/`);
await go(`/`);
const hrLand = await ev('location.pathname');
check('HR lands on My work, not the owner overview', hrLand.endsWith('/home/my-work'), hrLand);
await go(`${WS}/hr/attendance`);
await shot('hr', 'demo', 'attendance');
await asUser('u_arjun');
await go(`${WS}/home/my-work`);
check('empty state for a role with no work', /all caught up/i.test(await main()), '');
await shot('admin', 'demo', 'mywork-empty');

// ---------------------------------------------------------------- B. starting data set: full RT-001 via the presenter runner
await asUser('u_owner');
await setVp('desktop');
await go(`${WS}/presenter/journey`);
await clickBtn('Reset: starting');
await sleep(300);
await submit('Reset Rentio data');
await sleep(1500);
const ds = (await db()).rentio.dataset;
check('reset to starting data set (isolated profile only)', ds === 'start', ds);
let steps = 0;
for (let i = 0; i < 20; i++) {
  const r = await clickBtn('Execute next step');
  if (r !== 'ok') break;
  steps++;
  await sleep(350);
}
check('all 17 RT-001 steps executed through the UI runner', steps === 17, steps);
await shot('owner', 'start→completed', 'rt001-trace', true);

// independent reconciliation from the raw ledger (not the app's lotAccounting)
const D = (await db()).rentio;
const fam = new Set(Object.values(D.lots).filter((l) => l.rootId === 'RT-001').map((l) => l.id));
const pos = new Map();
for (const m of D.movements) {
  if (m.from) pos.set(`${m.lotId}|${m.from}`, (pos.get(`${m.lotId}|${m.from}`) ?? 0) - m.qty);
  if (m.to) pos.set(`${m.lotId}|${m.to}`, (pos.get(`${m.lotId}|${m.to}`) ?? 0) + m.qty);
}
const kgv = (g) => g / 1000;
let factory = 0, distributor = 0, husk = 0, churi = 0, rejects = 0, other = 0;
for (const [k, q] of pos) {
  const [lot, loc] = k.split('|');
  if (!fam.has(lot) || q === 0) continue;
  const mat = D.lots[lot].material;
  if (mat === 'HUSK') husk += q;
  else if (mat === 'CHURI') churi += q;
  else if (mat === 'REJECT') rejects += q;
  else if (loc.startsWith('F1')) factory += q;
  else if (loc.startsWith('DIST:')) distributor += q;
  else other += q;
}
const sink = (kind) => D.movements.filter((m) => fam.has(m.lotId) && m.kind === kind && !m.to).reduce((a, m) => a + m.qty, 0);
const input = D.movements.filter((m) => m.lotId === 'RT-001' && m.kind === 'intake').reduce((a, m) => a + m.qty, 0);
const runIds = new Set(D.runs.filter((r) => fam.has(r.inputLotId)).map((r) => r.id));
const oilAdd = D.movements.filter((m) => m.kind === 'addition' && runIds.has(m.ref)).reduce((a, m) => a + m.qty, 0);
const res = { input: kgv(input), oil: kgv(oilAdd), factory: kgv(factory), distributor: kgv(distributor), retailer: kgv(sink('deliver-retail')), husk: kgv(husk), churi: kgv(churi), huskUsed: kgv(sink('internal-use')), churiOut: kgv(sink('external-dispatch')), rejectsLoss: kgv(rejects + sink('loss')), other: kgv(other) };
const total = res.factory + res.distributor + res.retailer + res.husk + res.churi + res.huskUsed + res.churiOut + res.rejectsLoss + res.other;
const exp = { input: 10000, oil: 20, factory: 4500, distributor: 3000, retailer: 1000, husk: 650, churi: 175, huskUsed: 200, churiOut: 100, rejectsLoss: 395, other: 0 };
check('independent RT-001 reconciliation from raw ledger', Object.entries(exp).every(([k, v]) => res[k] === v) && total === 10020, JSON.stringify({ ...res, total }));
check('exception opening stock not in RT-001 family', [...fam].every((l) => !l.startsWith('MIG')), '');

// ---------------------------------------------------------------- C. safety controls (blocked attempts leave stock unchanged)
const movesNow = async () => (await db()).rentio.movements.length;
for (const [label, expectBlocked] of [['Over-issue stock', true], ['Self-approve a request', true], ['Dispatch held stock', true], ['Simulate storage failure', true]]) {
  const before = await movesNow();
  const r = await clickBtn(label);
  await sleep(500);
  const alertText = await ev(`[...document.querySelectorAll('.inline-alert,[role=alert]')].map(x=>x.textContent).join(' | ')`);
  const after = await movesNow();
  check(`${label}: rejected without partial change`, r === 'ok' && after === before && /blocked|nothing changed|Not saved|Not posted/i.test(alertText), alertText.slice(0, 220));
}
{
  const before = (await db()).rentio.movements.length;
  await clickBtn('Submit twice');
  await sleep(500);
  const after = (await db()).rentio.movements.length;
  const t = await ev(`[...document.querySelectorAll('.inline-alert,[role=alert]')].map(x=>x.textContent).join(' | ')`);
  check('Repeated submission: one effect only', after === before + 1 && /no second deduction/.test(t), `${before}->${after}`);
}
await shot('owner', 'completed', 'safety-controls');

writeFileSync(OUT + '../live-results.json', JSON.stringify({ at: new Date().toISOString(), profile: 'isolated disposable Chrome profile', checks: log, consoleErrors: [...new Set(errors)], screenshots: shots }, null, 2));
console.log(JSON.stringify({ passed: log.filter((c) => c.ok).length, failed: log.filter((c) => !c.ok), errors: [...new Set(errors)].slice(0, 10), shots: shots.length }, null, 1));
ws.close();
process.exit(0);
