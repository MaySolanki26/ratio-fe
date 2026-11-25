# Rentio Smart ERP prototype — build status

**Last updated:** 25 Nov 2026 (after the independent BA closure retest)

**State:** a working local client-demonstration prototype; **not production-ready**. All 16 modules have a working flow and RT-001 reconciles to 10,020 kg. The required checks pass. Review findings B1–B5 and U1–U3 are closed (`REVIEW_ROUND_1_RESULTS.md`). Owner-acceptance items P0–P2 are fixed and regression-tested (`OWNER_ACCEPTANCE_ROUND_2_RESULTS.md`, which also holds the 16-module × AC-01…AC-27 map). Requirement-level gaps remain (§8).

**Graphical views round** (user request: “dashboard and all flow must have graphical views”):
- **Shared primitives** in `src/rentio/graphics.tsx`:
  - `FlowChain`: process / stock / order flow with side exits and status in words;
  - `StackBars` / `ShareStrip`: exclusive parts on a zero baseline;
  - `RunTimeline`: planned vs working / held / late; each run gets its own scale when runs span days;
  - `GenealogyTree`.
- **Shared derivations** in `src/rentio/flows.ts`: `stockFlow`, `routeFlow`, `lotRouteFlow`, `lotOutcome`, `genealogy`. The lot-trace component is in `src/rentio/LotTrace.tsx`.
- **Page builders:** `pages/_graphA.tsx` and `pages/_graphB.tsx`.
- **Coverage:** the owner overview has 6 graphics, and every flow page now has at least one: Stage board, My stage (including a live mass-balance bar in Record output), Yield & trace, Presenter, Godowns stack map, Inventory, Husk & Churi, Holds & counts, Intake, Route, Grading, Handovers, Daily close, Repack, Replenish, Orders, Distributors, Delivery stops, Logistics, Salesman, Returns, Tally, Attendance, Season, Alerts, Approvals, Incidents and Inbox.
- **Rules every graphic follows:**
  - its figures come from the same read-scoped rows as the tables;
  - every graphic has a legend, hover text and a “Show as table (same figures)” view;
  - categorical colours are the validated reference palette (`--rt-c1…c5`, light and dark steps; dataviz validator passes, with the light-mode contrast warning relieved by labels and tables);
  - status colours are used only for state, always with text.
- **Tests:** `src/test/rentio-graphics.test.tsx` (28 tests) checks graphics on the dashboard and on every flow page, that stacked parts never exceed their scale, that the RT-001 share strip equals 10,020 kg, that flows are scoped, and that D01 graphics carry no D02.
- **Checks:** 25 files, 278 tests passing; build passes.
- **Browser check** (isolated headless Chrome profile): 34 page views at desktop and phone, light and dark, every one with graphics, no horizontal page scroll and 0 console errors. Evidence: `docs/rentio/graphics-round/` (screenshots, `graphics-results.json`, `scripts/graphics.mjs`).

**BA closure round at a glance** (details, fixtures and click-by-click retest script: `BA_CLOSURE_RESULTS.md`):
- **Controlled repacking** (`domain/rentio/repack.ts`, Godowns & stacks): measured proposal → independent QC release → one atomic posting; child lot keeps grade, mfg date and best-before; loss with reason; packaging deducted once.
- **Multi-stop delivery proof** (`delivery.ts`, Trips & freight + Distributor stock): one trip, ordered stops, per-stop Accepted / Part accepted / Refused by the scoped distributor; refused quantity stays in transit until Godown returns it to Quarantine.
- **Grouped incidents** (`incidents.ts`, Home › Incidents): Owner / Factory Head group live alerts under one lead; children stay with their owners; close refused while any child is live.
- **Replenishment suggestions** (`replenish.ts`, Season & planning › Replenishment suggestions): plant raw, critical stores incl. pouches, partners; inputs/units/cutoff/reviewer shown; stale partner data needs confirmation; review posts nothing and hands off to the prefilled Purchase / Order form.
- **Owner charts** (`pages/Charts.tsx`), **Inbox** (`rentio/inbox.ts`, `pages/Inbox.tsx`), **local demo login/logout** (`rentio/Login.tsx`, `/login`), **light theme first** per user (`services/settings.ts`).
- **Independently browser-tested** as owner and staff. The retest covered all four business flows, chart drill-down and phone layout, Inbox scope, demo sign-in and persistent appearance. The Factory Head view respects partner scope, and overdue or stale replenishment data cannot re-enable a recommendation incorrectly.

**Round 2 at a glance:**
- **Event-time chronology** is enforced in the engine: output → issue → receipt → start → hold/resume/finish → next issue. Future times are refused, and every refusal is atomic.
- **Review CTAs.** Owner Home shows "Review" with the named operator, and focused records show the exact next step.
- **Demo hand-off.** A labelled button switches to the operator on the same record.
- **Role-switch landing.** Switching role from a page the new role can't open lands on their My work.
- **Held stock.** `reallocateAtRisk` atomically replaces reservations on held stock.
- **Order status.** One `orderStatus()` derivation (the multi-stack receipt bug is fixed; disputes are distinct; payment is never implied).
- **Errors.** A success toast clears stale error toasts.
- **Live-retest fixes:**
  - **#6:** a picked minute that contains the predecessor event resolves to that instant (`fromLocalInputAfter`), so an immediate same-minute receipt after a godown issue works and earlier minutes are still refused. Times with seconds now show them.
  - **#5:** module shortcuts go to the first page the role may open (`moduleLanding`, rail and mobile), and Rentio's work-queue shortcut opens My work.
  - **#7 (recall duplicates)** was not addressed by this pass. A `rentio-recall.test.tsx` from another contributor exists in the tree and passes.
- **Not verified:** the live-browser retest was **not** run in round 2.

To resume in a new session, read in this order: `CLAUDE.md` → this file → `BA_CLOSURE_RESULTS.md` → `OWNER_ACCEPTANCE_ROUND_2_RESULTS.md` → `REVIEW_ROUND_1_RESULTS.md` → `DEMO_ASSUMPTIONS.md`.

## 1. Run it

```bash
cd clinic-ops-admin
npm ci                            # only if node_modules is missing
npm run typecheck                 # clean
npm test                          # 24 files, 250 tests, all passing (BA closure retest)
npm run build                     # passes (Vite >500 kB chunk warning; harmless)
npm run dev -- --host 127.0.0.1   # → http://127.0.0.1:5173/
```

- **Storage.** Data lives under the localStorage key `rentio.erp.db.v1` (data version **102**). The clinic key `uab.clinic-ops.db.v1` is never written. A store from an older version is copied to `rentio.erp.db.v1.backup.v<old>` before re-seeding.
- **First load** shows the **local demo sign-in** (`/login`, all 15 users). The data is the **demo snapshot**: RT-001 completed, RT-003 waiting for a manual handover at Oiling, RT-004 raw ready in R1, every exception case, plus the BA closure fixtures (MIG-0030 repack, MIG-0031 / SO-0006 / SO-0007 multi-stop, pouches, RT-005). Browsers already holding version-102 data keep it — reset to **Demo snapshot** (after **Download backup**) to get the new fixtures.
- **Landing page.** Staff land on **My work**; the Owner and Factory Head land on the **Owner overview**. **Log out** is in the account menu; the sign-in marker is `rentio.erp.db.v1.signin`.
- **Presenter tools** (Owner and Admin only): the client script, the RT-001 runner and trace, the safety-control buttons, reset to *demo* / *starting* / *completed*, and JSON backup and restore. The account menu also has a reset with the same three choices.

## 2. Client walkthrough and role switching

- **Walkthrough (8–10 minutes):** `REVIEW_ROUND_1_RESULTS.md` §7, also built into *Presenter tools › Demo script & RT-001 trace*.
- **Switching role:** use the avatar menu at the top right.

| User | Role and scope |
| --- | --- |
| Vikram | Owner |
| Sunita | Factory Head |
| Suresh | Stage owner: Cleaning, G1 |
| Anil | Stage owner: Oiling, Conditioning, Drying |
| Prakash | Stage owner: Peeling |
| Deepa | Stage owner: G2, Packing |
| Kiran | Back Office |
| Meera | QC |
| Ravi | Godown/Dispatch |
| Dinesh | Distributor D01 |
| Farah | Distributor D02 |
| Rohit | Salesman, mapped to D01–D03 |
| Neha | Accounts |
| Pooja | HR |
| Arjun | Administrator |

## 3. Architecture (where things are)

**Swappable domain pack.** `src/domain/active.ts` holds the active pack; Rentio is the default (`domain/default.ts`). The clinic pack is preserved in `domain/clinic/domain.ts`, and its tests select it.

**Store.** `src/services/db.ts` keeps a separate key per domain. `commitDraft` is all-or-nothing (clone → validate → write → swap). Also: `exportDb`/`importDb`, backup of older-version data, and the `__failNextWrites` test hook.

**Domain** (`src/domain/rentio/`):

| File | Contents |
| --- | --- |
| `engine.ts` | Ledger and positions, `holdReasons`; `stockRows` with separate dimensions (holds / held / expired / sellable / readyToProcess / reserved / available / reservedAtRisk); `execute` with idempotency, invariants and the **period lock** |
| `scope.ts` | **Read scope** (explicit role allow rules) plus every scoped selector — the only way screens read data |
| `access.ts` | Roles and capabilities, plus `PAGE_ACCESS` → `page:<module>/<page>` capabilities (navigation and route guard) |
| `ops.ts` | Intake, stages (`runTiming` with honest ETA; `reviseEta`), godown, approvals |
| `commerce.ts` | Orders, dispatch, distributors (with **excess receipt**), salesman/offline, Tally/IRN (simulated), returns, logistics |
| `people.ts` | Route, equipment, decisions, HR/payroll, season/plan/baseline |
| `control.ts` | Period lock and reopen, retained samples, scoped audit export (`auditRows`, `toCsv`) |
| `close.ts` | Daily close |
| `views.ts` | Lot accounting, summaries, funnel; **alerts** (named owner, action label, `?focus=` source link, due time, timed escalation, scope) and **My Work** |
| `scenario.ts` | RT-001 — resumable steps with `done()` predicates |
| `fixtures.ts` | Exception cases EX-1…EX-9 and `buildDemoExtras` (RT-003/RT-004) |
| `domain.ts` | Data sets `demo` (default), `start` and `completed`, built by replaying transactions |

**UI** (`src/rentio/`):

| File | Contents |
| --- | --- |
| `store.ts` | `act` / `useAct` / `runStep`; error text passes through `plain()` so requirement codes are not shown to staff |
| `clock.ts` | Shared refreshing clock, 30 s tick |
| `ui.tsx` | Kit: `Table` with `focus`, `useFocusId`, scoped `LotDrawer`, `Details`, `ImplNote`, `Eta`, `Steps`, `ActionForm`/`FormButton` |
| `pages.tsx` | Page registry |
| `pages/*.tsx` | 27 screens. `StageWork.tsx` exports `ReceiveButton`, `StartButton`, `OutputButton`, `IssueButton`, `EtaButton` and `HoldResumeButton`, which My Work reuses. Page helpers: `_stockHelpers.ts`, `_distHelpers.tsx`, `_opsHelpers.ts` |

**Shell.**
- The one-line demo notice and "What is real?" (full simulation list and module map M1–M16) are in `components/shell/AppShell.tsx` and `help.tsx`.
- The route guard and staff landing are in `App.tsx`.
- Focus handling for dialogs is fixed in `components/primitives/overlay.tsx`.

## 4. Module coverage (all 16, navigation in business language)

| Module | Navigation | Working behaviour |
| --- | --- | --- |
| M1 Masters & setup | Masters & setup | Metadata grids for SKUs, suppliers, 17 distributors, retailers, buyers, transporters and godowns; process route versions; machine readiness |
| M2 Procurement & intake | Buying & intake | Purchase; truck intake held until an independent check; partial accept/reject; duplicate slip blocked; bill matching |
| M3 Grading | Production › Grading | G1/G2 child lots; balance; re-grade by maker-checker |
| M4 Production | Production › Stage board, My stage, Handovers, Daily close | Receive → Start → Record output → Issue; pending custody; balanced output; holds; ETA revisions; daily close |
| M5 Godown | Godowns & stock › Godowns & stacks | Stacks with capacity and bags; stack totals reconcile to the godown; put-away; transfers; fumigation; location holds; **controlled repacking with QC release** |
| M6 Inventory | Stock by lot, Husk & Churi, Holds & counts | Separate stock dimensions; FEFO; expiry; stores; by-products; holds with descendant propagation; counts; **retained samples** |
| M7 Dispatch | Dispatch & distributors › Orders & dispatch | Credit check; FEFO reservation without moving stock; dispatch weight check; transit; line balances |
| M8 Distributors (17) | Distributor stock | Own-only scope; receipt with good / damaged / short / **excess**; retail delivery deducts once; outside sales; transfers; counts |
| M9 Salesman | Sales & returns › Salesman app | Mapped scope; rate snapshot; offline queue with revalidated sync and conflicts; provisional collections |
| M10 Tally (simulated) | Accounts & reports › Tally & e-invoice | Queue, failure/timeout simulator, lookup-before-retry, one IRN per invoice; collections and credits |
| M11 Returns | Returns & complaints | Unknown-lot flag; held return; release/dispose with evidence and approval; replacement and credit separate; recall trace (network roles only) |
| M12 Logistics | Trips & freight | Rate-card snapshots; vehicle changes; freight bill matching; shortfall settlement; **multi-stop trips with per-stop proof and refused-goods return** |
| M13 Control tower | Home | **Decision-first owner overview with two charts**, incident and replenishment summaries; My work; **Inbox**; alerts with named owner, exact source and **timed escalation**; **grouped incidents**; approvals; decisions |
| M14 Reports | Yield, costing & trace; **Period close & audit export** | Lot trace with CSV; yields; by-product reconciliation; provisional costing; performance; **period lock**; **scoped audit export** |
| M15 HR & payroll | HR & payroll | Simulated biometric import with dedupe; overnight shifts; versioned payroll authorized by a different person; restricted |
| M16 Season & forecast | Season & planning | Season factor for new runs; plan readiness; target vs actual; forecast gated by an approved baseline; **replenishment suggestions** (raw, stores, partners) with audited review and prefilled hand-off |

## 5. Invariants → evidence

Tests are in `src/test/`: `rentio.test.ts` (domain), `rentio-review.test.tsx` (round 1), `rentio-pages.test.tsx` (every screen × 11 roles × 2 data sets, store tests and a no-requirement-codes check) and `rentio-app.test.tsx` (shell and guards). The original rows below are unchanged; this round adds the last five.

| Invariant | Evidence |
| --- | --- |
| Lot identity | Every movement |
| No parent/child double count | `lotAccounting`; independent live raw-ledger reconciliation |
| Physical / condition / reservation separate | Round-1 B2 tests |
| Issue → pending → receipt; residual accountable | Residual and B5 tests |
| No negative stock | Engine and invariant check; live over-issue check |
| Transformation balance | Unbalanced-output test; live balanced output |
| Rework is existing material | Ancestry test |
| Net vs packaging vs vehicle tare | Dispatch check; stores test |
| Held/expired cannot fulfil; holds reach descendants and reservations; location holds | Hold tests |
| Corrections preserve originals | Settlements and adjustments are new linked movements |
| No duplicate effects | Idempotency tests; live "Submit twice" |
| Self-approval rejected | Intake, re-grade, payroll and period-reopen tests; live check |
| Atomic, visible persistence failure | Store tests; live storage failure |
| Rate and route versions traceable | Rate-conflict test |
| Settlement separate from delivery | Tally tests |
| **Read scope** (actions *and* reads) | Round-1 B1 tests (selectors, drawer, direct URLs, deep link); live D01/D02 checks |
| **Honest ETA and a refreshing clock** | Round-1 B3 tests (boundary, revision, escalation, idle-screen flip) |
| **Exact source** | Round-1 B4 tests (link focus ids; highlighted rows) |
| **Period lock** | Back-dated posting refused; reopen needs a different person |
| **Event-time chronology** (round 2) | Back-dated issue, pre-issue receipt, pre-receipt start, run event order, future time, fungible multi-receipt, valid full replay — `rentio-acceptance2.test.tsx` |
| **One order status; atomic reallocation** (round 2) | Fixture statuses, cross-view consistency, all-or-nothing reallocation — `rentio-acceptance2.test.tsx` |
| **Excess and samples** | Excess held as `UNID-EXC-…`; sample held, then deducted once |
| **Repack balance, QC separation, source intact on failure** (BA) | `rentio-ba-closure.test.ts`, `rentio-ba-ui.test.tsx`, `rentio-guard-fixes.test.ts` |
| **Per-stop settlement once; refusal never completes the trip** (BA) | same files |
| **Incident never clears children; close gated** (BA) | `rentio-ba-closure.test.ts`, `rentio-ba-ui.test.tsx` |
| **Suggestions never post; stale data needs confirmation** (BA) | same files |
| **Inbox scope, logout/login, per-user light theme** (BA) | `rentio-shell.test.tsx` |

## 6. Latest results (25 Nov 2026)

**BA closure round and independent retest:** typecheck clean; **248/250 tests in 24 files**; build passes with the main-bundle size warning. All eight requested changes were checked in the running app or its automated guard tests. All 17 RT-001 steps were also replayed in the browser and reconciled to 10,020 kg after reload. See `BA_CLOSURE_RESULTS.md` for the demo paths and retest summary.

**Round 2 (owner acceptance):**
- Typecheck clean; **184/184 tests in 17 files** (the 15 new tests are in `src/test/rentio-acceptance2.test.tsx`); build passes.
- **The live-browser retest was not performed in round 2.** Network and browser commands needed interactive approval in that session. Until an independent retest runs, round-2 UI behaviour is verified by full-app jsdom tests only.

**Round 1** (results below are unchanged by round 2):

- **Automated:** typecheck clean; **169/169 tests**; build passes.
- **Live, in an isolated disposable headless Chrome profile:** **40/40 checks, 0 console errors.**
  - All 17 RT-001 steps executed through the UI.
  - Independent raw-ledger reconciliation came to 10,020 kg.
  - A manual handover by Anil, on phone then desktop.
  - The keyboard path.
  - D01/D02 scope.
  - Four blocked controls with no stock change, plus one repeated submission with a single effect.
  - Evidence: `docs/rentio/review-round-1/` (screenshots, `live-results.json`, scripts).
- **Not yet verified:**
  - A first-time-user usability session.
  - Screen reader, other browsers and real devices.
  - Multi-user concurrency.

## 7. Honest limitations

- In-browser permissions, scope and audit demonstrate the rules but are **not a security boundary**, and the audit is not tamper-evident.
- Tally, IRN/e-way bill, WhatsApp/SMS, biometric import and the salesman's offline device are **simulated**.
- All business values are demo defaults (`DEMO_ASSUMPTIONS.md`); there are no statutory formulas.
- A single plant is modelled; edits are atomic within one tab only.
- There is no capacity-based remaining-route ETA; once a run is overdue, only a named revision gives a forecast.
- Page-local filters (e.g. Inventory search) are not kept in the URL. Focus and distributor selection are.
- Approval `rule` strings still store requirement codes; they are stripped on display.
- The main bundle is larger than 500 kB.

## 8. Requirement-level gaps (by ID)

| Requirement | Status |
| --- | --- |
| FR-103 / WF-13 Repacking preserving origin and expiry | Implemented (BA closure; one source lot per repack, no photo evidence) |
| FR-112 / EC-61 Multi-stop delivery proof (per-stop accept/refuse) | Implemented (BA closure; proof is a reference string; disposition = return to factory) |
| FR-115 Grouped incidents with one lead | Implemented (BA closure; children are alerts) |
| FR-075 Timed escalation | Implemented in round 1 (derived from age; in-app only, no message delivery per level) |
| BR-010 / EC-40 Period lock | Implemented in round 1 |
| FR-082 / NFR-10 Audit export | Implemented in round 1 (scoped CSV) |
| FR-044 / §18 Unidentified excess at receipt | Implemented in round 1 |
| FR-102 Retained samples | Implemented in round 1 (spills/sweepings not separately modelled) |
| FR-093/096/097 Machine readiness | Readiness blocks runs; no repair-task workflow |
| FR-101/106/113/117 Replenishment suggestions | Implemented (BA closure; no stores purchase document — audited review + link) |
| FR-109 Financial reconciliation to Tally balances | Simulated statuses only |
| FR-111 Corrective actions for recurring complaints | Not implemented |

A module rendering does **not** mean its requirements are complete. Production readiness additionally needs server enforcement, real authentication, transactional storage, backup/recovery, validated integrations and load testing.

## 9. Next steps

1. Run a first-time-user session (owner < 1 minute; worker completes a cycle unaided).
2. Decide whether to bump the data version so existing browsers receive the BA fixtures automatically (old data is backed up to `.backup.v102`).
3. Keep page filters in the URL; split the bundle into smaller chunks; add Playwright end-to-end tests from `review-round-1/scripts/review1.mjs`.
4. Replace demo defaults with validated Rentio values (OQ-01/02/03/12/13).

## 10. Resume notes

- Read through `scope.ts` selectors only. Never iterate `s.lots`, `s.movements` or `stockRows(s)` directly for display, search or export.
- Every write goes through `useAct()` with the `ActionForm` key (idempotency). Services re-check capability and scope.
- New alerts or work items must set `sourceId`, a `?focus=` link, an action label, a named `ownerId` and `scope`.
- Requirement IDs go in `<ImplNote>`. The page tests fail if FR/BR/EC/OQ codes appear in normal copy.
- New scenario steps need a `done(db)` predicate.
- The clinic tests call `useDomain(clinicDomain)`; keep them green.
- **Event times.** Every posting's `at` is checked against the location timeline (`checkChronology`) and must not be in the future. Tests must use real or past times, never a fixed future "now". The scenario runner uses `fitAt` so it never back-dates after manual work.
- **Demo clock.** RT-001 fixtures are dated 16–24 Nov 2026 IST, so the demo machine's clock must be on or after 24 Nov 2026, 17:00 IST.
- **Alerts and status.** Alerts need `actionCap` (derived from the key prefix unless given). Use `ctaFor` for CTA labels and `orderStatus` / `OrderStatusChip` for any order status; never re-derive status in a page.
