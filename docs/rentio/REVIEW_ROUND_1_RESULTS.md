# Rentio prototype — review round 1 results

**Date:** 25 Nov 2026 (IST) · **Reviewed build:** working files in `clinic-ops-admin/`, uncommitted on top of baseline commit `f85792d`. The review doc says `f8576f0`; the repository's only commit is `f85792d`.
**Local URL:** http://127.0.0.1:5173/ (Vite dev server, `npm run dev -- --host 127.0.0.1`).
**Input:** `RENTIO_PROTOTYPE_REVIEW.md`, findings B1–B5 and U1–U3. The requirements copy in `ChatGPT/Rentio/deliverables` is byte-identical to `docs/rentio/RENTIO_SMART_ERP_PRODUCTION_REQUIREMENTS.md`.

## Verdict

| Question | Answer |
| --- | --- |
| Client prototype demonstration | **Ready for a guided demonstration.** All review findings were reproduced and corrected, with automated and live-browser evidence. |
| Production deployment | **Not ready, and not claimed.** Permissions, audit and storage run in the browser. A production system needs server enforcement, real authentication, transactional storage, backups and validated integrations (see §6). |
| First-time-person usability | **Not yet validated.** The "owner understands in under one minute" and "staff complete a cycle without help" criteria still need a real first-time user. Automated checks cannot prove them. |

## 1. How the results were verified

- **Automated:**
  - `npm run typecheck`: clean.
  - `npm test`: **16 files, 169 tests passing** (140 before this round; this round added 27 review regressions and an old-data backup check, and updated 2 existing checks).
  - `npm run build`: passes; the >500 kB chunk warning remains.
- **Live browser:** headless Google Chrome 158, driven over the DevTools protocol against the running dev server.
  - Used a **new, isolated, disposable profile** (`--user-data-dir` in the session scratchpad). The user's own browser data was never read, reset or changed.
  - Script: `docs/rentio/review-round-1/scripts/review1.mjs` (keyboard probe: `kb.mjs`).
  - Results: `docs/rentio/review-round-1/live-results.json`: **40 of 40 checks passed, 0 console errors** (run at 2026-11-24T20:12Z, i.e. 25 Nov 01:42 IST).
- **Live RT-001:** this session executed **all 17 RT-001 steps in the browser** through the presenter runner, starting from the *starting* data set. It then reconciled the result independently from the raw movement ledger in `localStorage`, without using the app's own reconciliation code:

  | Measure | kg |
  | --- | --- |
  | Input | 10,000 |
  | Oil | 20 |
  | Factory | 4,500 |
  | Distributor | 3,000 |
  | Retailer delivered | 1,000 |
  | Husk remaining | 650 |
  | Churi remaining | 175 |
  | Husk internal use | 200 |
  | Churi external dispatch | 100 |
  | Rejects and losses | 395 |
  | Other | 0 |
  | **Total** | **10,020** |

  The exception-case opening stock (`MIG-xxxx`) is outside the RT-001 family.
- **Manual staff handover, without the runner:** as Anil, on a phone viewport then desktop, using My work: Receive RT-003/G1 → Start → Record output (2,976 kg incl. 6 kg oil) → Issue to Conditioning. Afterwards, Conditioning's receipt appears as the next task.
- **Not inherited:** the previous reviewer stopped after Journey step 1. Every live result above comes from this session's own run.

## 2. Findings — reproduction, fix and evidence

None of the findings had already been corrected; all five B findings and all three U findings reproduced against the current files before editing.

### B1 (P0): data scope leak

- **Reproduced:**
  - `Inventory.tsx` read `stockRows(s)` with no actor filter.
  - `LotDrawer` read every position and movement of a lot.
  - The Godowns page opened for any role.
  - `alertsFor` filtered by role only, so a D02 shipment alert reached D01.
  - As D01, `/stock/inventory` showed MIG-0002 750 kg and MIG-0003 250 kg (D02 stock).
- **Fix:**
  - **Central read scope.** New `domain/rentio/scope.ts` with explicit allow rules per role:

    | Role | Can see |
    | --- | --- |
    | Owner, Accounts | Whole network |
    | Back Office, QC | Plant, transit and distributors |
    | Factory Head, Godown | Plant and transit |
    | Stage owner | Own stages only |
    | Distributor | Own distributor only |
    | Salesman | Mapped distributors only |
    | HR, Admin | No stock |

    Missing or empty scope returns *No stock visibility*, never "all".
  - **Selectors.** `scopedStockRows`, `scopedMovements`, `scopedLots`, `canReadLot`, `scopedPositions`, `scopedOrders`, `scopedShipments`, `scopedHandovers`, `scopedRuns`, `scopedComplaints` and `scopedApprovals` are used by every Rentio screen, the lot drawer, search, CSV/audit export and alerts.
  - **Route guards.** `PAGE_ACCESS` in `access.ts` becomes `page:<module>/<page>` capabilities. These drive both the navigation and a guard in `App.tsx` ("No access to this page" for direct URLs).
  - **Alerts.** Each alert carries its record scope (location, distributor, stage); `alertsFor` filters on it.
  - **Defaults.** Staff land on My work instead of the owner overview.
- **Changed files:**
  - New: `domain/rentio/scope.ts`.
  - Edited: `domain/rentio/access.ts`, `domain/rentio/pack.ts`, `domain/rentio/views.ts`, `App.tsx`, `rentio/ui.tsx` (LotDrawer) and every page in `rentio/pages/`.
- **Tests** (`src/test/rentio-review.test.tsx`, B1 block):
  - D01 has no D02, factory or transit-to-others rows, lots, shipments, orders, movements or alerts.
  - D02 has no D01 rows.
  - The salesman is limited to D01–D03; HR, Admin and empty scopes see nothing.
  - Stage-only and plant-only scopes are enforced.
  - The lot drawer shows "Not available" for D01 on MIG-0002.
  - Direct-URL guards were checked for D01 (9 URLs), the salesman, HR and a stage worker.
  - A D02 deep link (`?d=D02&focus=SH-…`) opened by D01 shows "not in your area" without D02 figures.
- **Live checks:**
  - D01 `?d=D02` is blocked.
  - D01 is blocked from `/stock/inventory` and `/stock/godowns`.
  - D01's alerts contain nothing about D02.
  - D02 does not see D01.
  - Godown's inventory search shows no distributor stock.
- **Screenshots:** `15-distributor-D01-phone-…`, `16-distributor-D01-desktop-demo-inventory-url-blocked.png`, `17-distributor-D02-…`, `12-godown-ravi-…-inventory-search-A1.png`.
- **Remaining limitation:** enforcement is in-browser and demonstrates the rule only. A user with developer tools can read `localStorage`. Server-side enforcement is required for production.

### B2 (P1): stock semantics

- **Reproduced:** `stockRows` set `held` for any reason a position was not sellable. After intake, raw 10,000 kg showed as held, and so did running WIP 2,900 kg and transit 25 kg.
- **Fix:**
  - **Separate dimensions.** `StockRow` now has independent `holds[]` (only genuine quality/treatment/recall holds, plus held-condition custody: gate awaiting check, quarantine, distributor damaged/returned), `held`, `expired`, `sellable`, `readyToProcess`, `reserved`, `available` (available to sell) and `reservedAtRisk`.
  - **Summaries.** `stockSummary` reports physical, held, expired, ready to process, reserved, reserved at risk, available and bags separately, never added together.
  - **Consumers updated together:** alerts (risk = reservation on non-sellable stock), the owner overview, inventory, godowns, holds, orders, distributors, the lot drawer and the stage screens.
- **Changed files:** `domain/rentio/engine.ts`, `domain/rentio/views.ts`, `rentio/ui.tsx`, and the stock, order and distributor pages.
- **Tests:**
  - Accepted RT-004 raw: `held=false`, ready 5,000 kg, not sellable.
  - Running WIP and transit are not held.
  - Summary held is 0 for raw, WIP and transit.
  - MIG-0001's parent hold still flags the packed child with 500 kg reserved at risk.
  - Quarantine is held, and dispatching the held reservation is still blocked.
  - A treatment hold on one stack leaves the other stacks sellable.
- **Live check:** none needed beyond the screens; the owner overview shows "5,000 kg ready to process", "On the road" and "1,000 kg on hold" separately.
- **Screenshots:** `01/02/03-owner-…-owner-overview.png`, `11-godown-ravi-…-godown-stacks.png`.
- **Remaining limitation:** none known for these dimensions. Lot merge/blending is still blocked by design (OQ-08).

### B3 (P1): timing credibility

- **Reproduced:**
  - `runTiming` clamped an overdue forecast to *now* (`ops.ts:531`), which looks like a promise.
  - `useR()` computed now at render time, with no clock subscription.
- **Fix:**
  - **ETA states.** `runTiming` returns one of four states:
    - `revised`: a named revision that is still in the future;
    - `baseline` or `hold-adjusted`: plan plus recorded hold time, while still in the future;
    - `needs_update`: no forecast at all;
    - `actual`: the run has finished.
  - **Lateness.** `delayMs` is measured lateness; `projectedDelayMs` is separate.
  - **ETA revisions.** New `reviseEta` lets the stage owner (in scope), Factory Head or planner set a revised ETA with a reason. History is kept in `run.etaRevisions`, the baseline is never changed, and the change is audited through the transaction log.
  - **Display.** The UI shows "ETA needs update", or a revised ETA with the person's name and reason.
  - **Shared clock.** New `rentio/clock.ts` ticks every 30 s, refreshes after each posting and catches up after idle. `useR()` subscribes to it.
  - **Escalation.** Timed escalation (FR-075) uses the same clock: past due goes to the Factory Head or functional lead; past twice the window goes to the Owner. Season mode shortens the window.
  - The wall clock is shown separately from distributor data freshness ("not updated in 24 h").
- **Changed files:**
  - New: `rentio/clock.ts`.
  - Edited: `domain/rentio/ops.ts`, `domain/rentio/types.ts`, `domain/rentio/views.ts`, `rentio/store.ts`, `rentio/ui.tsx` (`Eta`), `rentio/pages/StageWork.tsx`, `StageBoard.tsx`, `Season.tsx`, `ControlTower.tsx`.
- **Tests:**
  - Boundary: On Track at baseline −60 s; Delayed with no forecast and 60 s late at +60 s; 1 h late at +1 h.
  - Revision rules: out of scope, blank reason and past time are refused; a valid revision becomes the forecast; the baseline is unchanged; an expired revision reverts to needs-update.
  - Escalation levels 0/1/2 at +1 h, +5 h and +9 h.
  - Idle screen (fake timers): the stage screen shows On Track 20 s before plan, is unchanged after 29 s, and flips to Delayed plus "ETA needs update" at the next shared-clock tick, with no user action.
- **Live checks:**
  - The stage board shows "ETA needs update" for the late RT-002 run.
  - Suresh saves a revised ETA, which then shows "revised by Suresh Yadav".
- **Screenshots:** `05-factory-head-laptop-demo-stage-board-eta-needed.png`, `06-stage-owner-suresh-…-stage-cleaning-late.png`.
- **Remaining limitation:** there is no capacity-based remaining-route ETA (OQ-12). Only named revisions provide forecasts once overdue.

### B4 (P1): exact source

- **Reproduced:**
  - Alert and My Work links in `views.ts` carried only the page or stage.
  - Orders always selected the first order.
  - Several forms expected typed lot IDs (oil and bag lots, the route stage list).
- **Fix:**
  - **Links.** Every alert and work item carries `sourceId` and a link with `?focus=<id>`, plus a meaningful action label ("Settle shortfall", "Update ETA", "Reallocate", "Check intake"…).
  - **Highlighting.** The shared `Table` highlights, scrolls to and focuses the focused row.
  - **Selection.** Pages select the focused record (order, distributor via `?d=`, Tally document, lot report), and show "not in your area or no longer open" if the record is hidden.
  - **Working where the task is.** Stage actions in My work are performed in place; permissions are rechecked by the services.
  - **Labelled selectors.** Typed IDs are replaced by selectors naming the item and its available quantity (e.g. "Edible oil … — 480 kg in stores", "RT-001/A1-PK · A1 · 120 bags · 3,000 kg available").
- **Changed files:** `domain/rentio/views.ts`, `rentio/ui.tsx` (`useFocusId`, focus in `Table`), `MyWork.tsx`, `StageWork.tsx`, and all fork-reworked pages.
- **Tests:**
  - Every alert link contains its `sourceId`.
  - Anil's first work item is "Receive RT-003/G1" with a focus link.
  - Opening exact links highlights the right row for a handover (Factory Head), an order (Back Office) and an approval (QC).
- **Live checks:**
  - The owner's Decide action opens Approvals with the record highlighted.
  - The worker's next action is performed in place.
- **Screenshots:** `04-owner-laptop-demo-decision-exact-source.png`, `07-stage-owner-anil-phone-demo-mywork-next-receive.png`.
- **Remaining limitations:**
  - Page-local filters (e.g. Inventory search) are not kept in the URL, so Back does not restore them. Distributor selection and focus are kept.
  - Evidence references, truck and slip numbers remain free text; these are observed values, not internal IDs.

### B5 (P1): partial receipt clarity

- **Reproduced:** the receive form led with "Sender issued 2,950 kg" when only 50 kg was outstanding.
- **Fix:**
  - **Receive form.** Shows **Originally issued · Already received · Outstanding · Receive now · Left outstanding after this** together. "Receive now" is the field label, the remaining balance updates live, and over-receipt shows as "x kg too much".
  - **Same pattern elsewhere:** godown put-away (+ bags), intake check (net / accept / reject / unaccounted), distributor receipt (shipped / good / damaged / short / excess), retail delivery, and the output balance ("Accounted for" / "Balanced ✓").
  - **Safeguards kept:** inputs are preserved on error, and the per-form idempotency key still stops duplicates.
- **Changed files:** `StageWork.tsx` (`ReceiveButton`), `Godowns.tsx`, `Intake.tsx`, `Distributors.tsx`, `Handovers.tsx`.
- **Tests (DOM):**
  - All five preview labels appear.
  - 3,000 kg against 2,970 outstanding is refused with "Not posted — nothing changed" and the 3,000 entry is kept.
  - A partial 2,950 kg posts exactly one movement and leaves 20 kg outstanding.
- **Live checks:** the same behaviour on a phone viewport, then the full manual cycle.
- **Screenshots:** `08-stage-owner-anil-phone-demo-receive-error-preserved.png`, `09-…-output-balanced-preview.png`, `10-…-mywork-after-manual-cycle.png`.

### U1: requirement codes in operational copy

- **Reproduced:** about 90 FR/BR/EC/OQ codes across the pages, and in navigation (M1–M16), lot labels ("EC-45"), route history ("OQ-01") and error messages.
- **Fix:**
  - **Navigation** is in business language ("Buying & intake", "Dispatch & distributors"…). Module numbers are kept in Help › *Module map (M1–M16)*.
  - **Codes** move into a collapsed **Implementation details** element (`ImplNote`) on each page.
  - **Errors** pass through `plain()` in `rentio/store.ts`, which strips requirement codes.
  - **Source strings** with codes were rewritten.
- **Tests:** every Rentio screen × 11 roles × 2 data sets asserts that no `FR|BR|EC|OQ|WF|NFR|AC-nnn` code appears outside Implementation details. The Decisions and presenter pages are exempt by design.
- **Remaining limitation:** approval `rule` strings still contain codes in stored data. They are stripped on display in Approvals, and alerts don't show them.

### U2: decision-first owner view

- **Fix:** `ControlTower.tsx` is rebuilt in this order:
  1. **Needs your decision:** authority exceptions only.
  2. **Top risks:** the top three, with escalations to the owner first; each shows the named owner, quantity or value, due time and an action label.
  3. **Stock flow:** Raw toor → In processing → Finished (bags + kg, free to sell, on hold) → On the road → At distributors (stale count).
  4. **Production now:** by stage, with lot, status, expected finish (or "ETA needs update") and the responsible person.
  5. **Finished stock by grade:** bags, kg, free to sell, reserved, on hold.
  6. **Delivery promises:** with promise and status.
  7. Distributor follow-up and money appear in progressive Details sections.
- **Live checks:**
  - The decision list comes before the stock flow.
  - No codes appear in normal copy.
  - The flow strip is present.
  - 1 decision and 3 risks show at 1280 × 720, all above the fold.
- **Screenshots:** `01/02/03-owner-{desktop,laptop,phone}-demo-owner-overview.png`.
- **Remaining limitation:** escalation windows are demo values (DEMO_ASSUMPTIONS.md); real thresholds are OQ-12/OQ-22.

### U3: banner and stage density

- **Fix:**
  - The persistent notice is now one line: "Prototype · Demo · fictional local data".
  - The full simulation list, production caveats and the module map are behind **What is real?**
  - The stage header shows owner and backup only; plan, tolerance and route details sit under "Stage details".
  - Empty stage sections collapse, and one **Next action** card leads the page.
- **Screenshots:** `07-…-phone-…`, `06-…-stage-cleaning-late.png`.

### Manufacturing presence (item 6) and repeatable demonstration (item 7)

- **Owner overview:** grade, bags and kg, stage status, quality holds, delivery promise risk and stale distributor data, all derived from the ledger.
- **Godown:** stacks with used/free capacity, bags, grade and condition, plus a computed "F1 total = sum of stacks ✓".
- **Worker landing:** **My work** with a Receive → Start → Record output → Issue stepper and one Next action.
- **Demo snapshot** (new default data set, `demo`):
  - RT-001 completed;
  - RT-003 waiting for Anil's manual receipt at Oiling;
  - RT-004 raw ready to process in R1;
  - every exception case included, with recent events time-relative.
- **Presenter tools** sit in their own module (Owner and Admin only):
  - the 8-step client script with links;
  - the RT-001 runner and trace;
  - the safety-control buttons;
  - reset to the *demo* / *starting* / *completed* data set (confirmation dialog offers a backup first);
  - JSON **backup and restore** of this browser's Rentio data (validated before replacing).
- **Changed files:** `domain/rentio/fixtures.ts` (`buildDemoExtras`), `domain/rentio/domain.ts` (schema 102, default `demo`), `rentio/pages/Journey.tsx`, `services/db.ts` (`exportDb`/`importDb`, backup of older-version data on load), `components/shell/AppShell.tsx` (reset choices), `domain/rentio/pack.ts` (presenter module).

### Shared-component fixes found during verification

- **Focus inside action forms.** The keyboard probe found that opening a form did not leave focus inside it, because the React StrictMode double effect returned focus to the trigger. Fixed in `components/primitives/overlay.tsx`: focus-return tracks the last control outside any dialog and won't steal focus from an open layer.
- **Tests.** The existing confirm and inspector tests still pass. A new test checks that focus moves inside on open and returns to the button on Esc. A live check uses real Tab, Enter and Esc key events.

## 3. Requirement-level gap audit

**Implemented this round:**

| Requirement | Status | Where / test |
| --- | --- | --- |
| FR-075 Timed escalation | **Implemented**: alerts escalate to the functional lead, then to the Owner by age; season shortens the window | `views.ts` `escalate()`; escalation test |
| BR-010 / EC-40 Period lock | **Implemented**: postings dated in a closed month are refused in the transaction runner; reopening needs a different person and a reason | `control.ts`, `engine.ts`, page *Period close & audit export*; test |
| FR-082 / NFR-10 Audit export | **Implemented**: scoped CSV of postings, blocked attempts and in-scope movements, with as-of header and formula guard | `control.ts auditRows/toCsv`; scoped-export test |
| FR-044 / §18 Unidentified excess on receipt | **Implemented**: excess is received into distributor held custody as `UNID-EXC-…`, with a dispute; never added to the shipped lot | `commerce.receiveShipment`; test |
| FR-102 Retained samples | **Implemented**: QC moves a sample to held sample custody; testing or disposal deducts it once; lot accounting stays balanced | `control.ts`, Holds & counts; test |

**Not implemented:**

| Requirement | Status | Where / test |
| --- | --- | --- |
| FR-103 / WF-13 Repacking | **Not implemented** | Repacking that preserves origin and expiry has no screen or service yet |
| FR-112 / EC-61 Multi-stop delivery proof | **Not implemented** | A trip settles per shipment; there is no per-stop accept/refuse record |
| FR-115 Grouped incidents | **Not implemented** | Related alerts are not grouped under one incident lead |

**Implemented earlier, unchanged:** FR-001–FR-119 behaviours listed in `BUILD_STATUS.md` §4. "Every module renders" does **not** mean every requirement is complete; see BUILD_STATUS §8–9.

## 4. Live verification checklist (40/40 passed)

| # | Area | Role(s) | Viewport | Data set |
| --- | --- | --- | --- | --- |
| 1 | Fresh isolated profile seeds the demo snapshot | — | desktop | demo |
| 2 | Owner overview: decisions first, no codes, Raw→…→Distributors strip | Owner | desktop, laptop, phone | demo |
| 3 | Decide opens the highlighted approval | Owner | laptop | demo |
| 4 | "ETA needs update", then a named revision | Factory Head, Suresh | laptop | demo |
| 5 | Manual handover: receive (over-receipt refused with input kept; partial preview), start, balanced output with oil, issue; next receipt appears; stores oil −26 kg in total | Anil | phone, desktop | demo |
| 6 | Keyboard: Tab to next action, Enter opens with focus inside, Esc closes, focus returns | Suresh | laptop | demo |
| 7 | Godown stacks reconcile; inventory search; no distributor rows | Ravi | laptop | demo |
| 8 | QC holds and My work | Meera | laptop | demo |
| 9 | D01 scope (own stock; D02 deep link blocked; Inventory/Godowns URLs blocked; alerts clean); D02 sees only D02 | Dinesh, Farah | phone, desktop | demo |
| 10 | Salesman app; Tally; period close & audit; HR lands on My work; admin empty state | Rohit, Neha, Pooja, Arjun | phone, laptop | demo |
| 11 | Reset to starting; all 17 RT-001 steps via UI; independent raw-ledger reconciliation = 10,020 kg; no MIG lots in the RT-001 family | Owner (presenter) | desktop | start→completed |
| 12 | Over-issue, self-approval, held dispatch and storage failure each rejected with no movement change; repeated submission produced exactly one movement | Owner (presenter acts as named users) | desktop | completed |

## 5. Screenshots

All in `docs/rentio/review-round-1/screenshots/`. Names follow `nn-role-viewport-dataset-screen.png`, where desktop is 1440 × 900, laptop 1280 × 720 and phone 390 × 844:

```
01-owner-desktop-demo-owner-overview.png        13-qc-meera-laptop-demo-holds.png
02-owner-laptop-demo-owner-overview.png         14-qc-meera-laptop-demo-mywork.png
03-owner-phone-demo-owner-overview.png          15-distributor-D01-phone-demo-own-stock.png
04-owner-laptop-demo-decision-exact-source.png  16-distributor-D01-desktop-demo-inventory-url-blocked.png
05-factory-head-laptop-demo-stage-board-eta-needed.png   17-distributor-D02-desktop-demo-own-stock.png
06-stage-owner-suresh-laptop-demo-stage-cleaning-late.png 18-salesman-phone-demo-salesman-app.png
07-stage-owner-anil-phone-demo-mywork-next-receive.png   19-accounts-laptop-demo-tally.png
08-stage-owner-anil-phone-demo-receive-error-preserved.png 20-accounts-laptop-demo-period-close-audit.png
09-stage-owner-anil-desktop-demo-output-balanced-preview.png 21-hr-laptop-demo-attendance.png
10-stage-owner-anil-desktop-demo-mywork-after-manual-cycle.png 22-admin-laptop-demo-mywork-empty.png
11-godown-ravi-laptop-demo-godown-stacks.png    23-owner-desktop-start→completed-rt001-trace.png
12-godown-ravi-laptop-demo-inventory-search-A1.png 24-owner-desktop-completed-safety-controls.png
```

## 6. What remains unverified or out of scope

- **No first-time-user session.** Nobody new to the product has used it, so the under-one-minute owner check and unassisted staff completion are untested.
- **Browser coverage was limited** to headless Chrome 158 on macOS. No screen reader, other browsers or real phones were tested. The phone layout used viewport emulation.
- **Concurrency** across tabs or users is not tested; edits are atomic within one tab only.
- **Production readiness** has not been assessed. It needs:
  - authenticated server-side enforcement of scope and permissions;
  - tamper-evident audit;
  - transactional storage with backup and recovery;
  - real Tally, IRN, messaging and biometric integrations;
  - performance at the required load.
- Business values remain **demo defaults** (`DEMO_ASSUMPTIONS.md`).

## 7. Run, roles and client walkthrough

**Run.**
```bash
cd clinic-ops-admin
npm run dev -- --host 127.0.0.1
```
Then open http://127.0.0.1:5173/. A browser with no saved Rentio data opens on the **demo snapshot**.
- **Back up first:** if your browser already holds Rentio data from earlier rounds, download a backup from *Presenter tools* before any reset.
- **Storage note:** the data version moved to v102. On first load, an older v101 store is **copied to `rentio.erp.db.v1.backup.v101`** before the demo snapshot is seeded (regression-tested).
- **Caveat:** this safeguard was added at the end of the round. If a normal (non-isolated) browser tab was open on the dev server during the work, Vite's hot reload may have re-seeded it before the safeguard existed, so earlier synthetic data in that tab may not be recoverable. Use *Presenter tools › Download backup* before any later reset.

**Switch role** from the avatar menu at the top right:

| Person | Role |
| --- | --- |
| Vikram | Owner |
| Sunita | Factory Head |
| Suresh, Anil, Prakash, Deepa | Stage owners |
| Kiran | Back Office |
| Meera | QC |
| Ravi | Godown |
| Dinesh | Distributor D01 |
| Farah | Distributor D02 |
| Rohit | Salesman |
| Neha | Accounts |
| Pooja | HR |
| Arjun | Admin |

Staff land on **My work**; the Owner lands on the **Owner overview**.

**8–10 minute client walkthrough.** This is also linked from *Presenter tools › Demo script & RT-001 trace*.

1. **Owner overview** (Vikram, about 1 min): one decision (the D04 credit override); top risks with named owners; stock flow Raw → Processing → Finished (bags) → On the road → Distributors.
2. **Late stage** (about 1 min): open Cleaning (RT-002). The planned finish is kept and "ETA needs update" shows. Switch to Suresh and give a revised ETA with a reason.
3. **Manual handover** (Anil, about 2 min): My work → Receive RT-003/G1 (show the preview) → Start → Record output, adding 6 kg oil (balanced) → Issue to Conditioning.
4. **Balanced output** (about 1 min): My stage › Peeling recent runs: 7,800 main + 1,000 rework + 700 Husk + 200 Churi + 100 loss.
5. **Finished bags** (Ravi, about 1 min): Godowns & stacks, where stack totals equal F1.
6. **Reserve → dispatch → receive** (Kiran, then Dinesh, about 2 min): reserve an order without moving stock, dispatch it into transit, and receive it at D01, including the extra-found field.
7. **Trace** (about 1 min): Yield, costing & trace for RT-001 shows 10,020 kg balanced back to Farmer Ramesh.
8. **Controls** (about 1 min): a held D02 order cannot ship; Kiran cannot approve his own intake; D01 cannot open D02 or factory pages.
