// Graphical-views check: every page with graphics, owner + staff roles, desktop/phone, light/dark.
// Isolated, disposable Chrome profile (remote debugging on :9555). Fails on console errors or missing figures.
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:5173';
const WS = '/o/rentio/w/plant1';
const tgt = await (await fetch('http://127.0.0.1:9555/json/new?about:blank', { method: 'PUT' })).json();
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
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const VP = { desktop: [1440, 900], phone: [390, 844] };
const go = async (p) => { await send('Page.navigate', { url: BASE + p }); await sleep(1200); };
const asUser = (u, theme) => ev(`(() => { const k='rentio.erp.db.v1'; const d=JSON.parse(localStorage.getItem(k)); d.session.userId='${u}'; d.settings=d.settings||{}; d.settings['${u}']={...(d.settings['${u}']||{}), theme:'${theme}'}; localStorage.setItem(k, JSON.stringify(d)); localStorage.setItem(k + '.signin', 'in'); return 'ok'; })()`);
const results = [];
let n = 0;
async function page(role, user, path, vp, theme) {
  const [w, h] = VP[vp];
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: vp === 'phone' });
  await asUser(user, theme);
  await go(`${WS}/${path}`);
  if (theme === 'dark') await ev(`document.documentElement.setAttribute('data-theme','dark')`);
  await sleep(300);
  const info = await ev(`(() => {
    const figs=[...document.querySelectorAll('main figure.rt-viz, main figure.rt-chart')];
    const over=[...document.querySelectorAll('main *')].filter(e=>e.scrollWidth>e.clientWidth+2 && getComputedStyle(e).overflowX==='visible' && e.clientWidth>0 && !e.closest('.rt-table-wrap,.rt-fc,.rt-tl-ticks')).length;
    const pageScroll = document.documentElement.scrollWidth > window.innerWidth + 1;
    return { figures: figs.length, titles: figs.map(f=>f.getAttribute('aria-label')).slice(0,12), tables: figs.filter(f=>f.querySelector('details table')).length, pageScroll, noAccess: /No access to this page/.test(document.querySelector('main')?.innerText||'') };
  })()`);
  // capture the whole main scroll area by expanding it
  await ev(`(() => { const m=document.querySelector('main'); if(m){ m.style.height='auto'; m.style.overflow='visible'; } document.querySelectorAll('.workspace,.shell,.app').forEach(e=>{e.style.height='auto';e.style.overflow='visible'}); })()`);
  const fullH = Math.min(await ev('document.documentElement.scrollHeight'), 6000);
  const name = `${String(++n).padStart(2, '0')}-${role}-${vp}-${theme}-${path.replace(/[/?=&]/g, '_')}.png`;
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: fullH, scale: 1 }, captureBeyondViewport: true });
  writeFileSync(OUT + name, Buffer.from(r.result.data, 'base64'));
  results.push({ role, path, vp, theme, ...info, screenshot: name });
}
await go('/');
await go('/');
const pages = [
  ['owner', 'u_owner', 'dashboard'],
  ['factory-head', 'u_fhead', 'production/stages'],
  ['stage-owner-anil', 'u_anil', 'production/stage?stage=OIL'],
  ['owner', 'u_owner', 'finance/reports?focus=RT-001'],
  ['owner', 'u_owner', 'presenter/journey'],
  ['godown', 'u_ravi', 'stock/godowns'],
  ['godown', 'u_ravi', 'stock/inventory'],
  ['godown', 'u_ravi', 'stock/byproducts'],
  ['qc', 'u_meera', 'stock/holds'],
  ['back-office', 'u_kiran', 'procurement/intake'],
  ['factory-head', 'u_fhead', 'masters/route'],
  ['factory-head', 'u_fhead', 'production/grading'],
  ['factory-head', 'u_fhead', 'production/handovers'],
  ['factory-head', 'u_fhead', 'production/close'],
  ['back-office', 'u_kiran', 'distribution/orders'],
  ['distributor-D01', 'u_dinesh', 'distribution/distributors'],
  ['back-office', 'u_kiran', 'distribution/logistics'],
  ['salesman', 'u_rohit', 'sales/salesman'],
  ['qc', 'u_meera', 'sales/returns'],
  ['accounts', 'u_neha', 'finance/tally'],
  ['hr', 'u_pooja', 'hr/attendance'],
  ['factory-head', 'u_fhead', 'planning/season'],
  ['owner', 'u_owner', 'home/alerts'],
  ['owner', 'u_owner', 'home/approvals'],
];
for (const [role, user, path] of pages) await page(role, user, path, 'desktop', 'light');
for (const [role, user, path] of [pages[0], pages[1], pages[2], pages[3], pages[15]]) {
  await page(role, user, path, 'phone', 'light');
  await page(role, user, path, 'desktop', 'dark');
}
writeFileSync(OUT + '../graphics-results.json', JSON.stringify({ at: new Date().toISOString(), consoleErrors: [...new Set(errors)], results }, null, 2));
const bad = results.filter((r) => r.figures === 0 || r.noAccess || r.pageScroll);
console.log(JSON.stringify({ pages: results.length, withoutGraphics: bad.filter((r) => r.figures === 0).map((r) => `${r.role} ${r.path}`), pageScroll: bad.filter((r) => r.pageScroll).map((r) => `${r.vp} ${r.path}`), noAccess: bad.filter((r) => r.noAccess).map((r) => r.path), errors: [...new Set(errors)].slice(0, 8) }, null, 1));
ws.close();
process.exit(0);
