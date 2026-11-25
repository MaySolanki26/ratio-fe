// Page length (scroll height of the work area) per page at 1440×900, signed in as a representative role.
// Usage: node measure.mjs <label> [port]   → writes ../heights-<label>.json
import { writeFileSync } from 'node:fs';
const label = process.argv[2] ?? 'run';
const port = process.argv[3] ?? '9666';
const only = (process.argv[4] ?? '').split(',').filter(Boolean);
const BASE = 'http://127.0.0.1:5173';
const WS = '/o/rentio/w/plant1';
const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const asUser = (u) => ev(`(() => { const k='rentio.erp.db.v1'; const d=JSON.parse(localStorage.getItem(k)); d.session.userId='${u}'; localStorage.setItem(k, JSON.stringify(d)); localStorage.setItem(k + '.signin', 'in'); })()`);
await send('Page.navigate', { url: BASE + '/' });
await sleep(1500);
const PAGES = [
  ['u_owner', 'dashboard'], ['u_anil', 'home/my-work'], ['u_owner', 'home/inbox'], ['u_owner', 'home/approvals'], ['u_owner', 'home/alerts'], ['u_owner', 'home/incidents'], ['u_owner', 'home/decisions'],
  ['u_fhead', 'masters/route'], ['u_kiran', 'procurement/intake'], ['u_fhead', 'production/stages'], ['u_anil', 'production/stage?stage=OIL'], ['u_fhead', 'production/grading'],
  ['u_fhead', 'production/handovers'], ['u_fhead', 'production/close'], ['u_ravi', 'stock/godowns'], ['u_ravi', 'stock/inventory'], ['u_ravi', 'stock/byproducts'], ['u_meera', 'stock/holds'],
  ['u_kiran', 'distribution/orders'], ['u_dinesh', 'distribution/distributors'], ['u_kiran', 'distribution/logistics'], ['u_rohit', 'sales/salesman'], ['u_meera', 'sales/returns'],
  ['u_neha', 'finance/tally'], ['u_owner', 'finance/reports'], ['u_neha', 'finance/close'], ['u_pooja', 'hr/attendance'], ['u_fhead', 'planning/season'], ['u_owner', 'presenter/journey'],
];
const out = [];
for (const [u, p] of PAGES.filter(([, p]) => !only.length || only.some((o) => p.startsWith(o)))) {
  await asUser(u);
  await send('Page.navigate', { url: `${BASE}${WS}/${p}` });
  await sleep(1100);
  const h = await ev(`(() => { const m=document.querySelector('main'); return m ? m.scrollHeight : 0; })()`);
  const wide = await ev(`document.documentElement.scrollWidth > window.innerWidth + 1`);
  out.push({ page: p, user: u, height: h, screens: Math.round((h / 852) * 10) / 10, horizontalScroll: wide });
}
writeFileSync(new URL(`../heights-${label}.json`, import.meta.url), JSON.stringify({ at: new Date().toISOString(), viewport: '1440x900', out, errors: [...new Set(errors)] }, null, 1));
console.log(out.map((o) => `${o.screens.toFixed(1).padStart(5)} screens  ${o.page}`).join('\n'));
console.log('errors', [...new Set(errors)].length);
process.exit(0);
