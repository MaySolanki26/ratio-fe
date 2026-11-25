# Rentio prototype — owner acceptance round 2 results

**Date:** 25 Nov 2026 (IST)
**Handoff:** `ChatGPT/Rentio/design-plans/CLAUDE_OWNER_ACCEPTANCE_ROUND_2.md`
**Checkout:** working tree in `/Users/maysolanki/Documents/Rantio/rantio-fe`. Nothing was committed or deployed, and all earlier working changes are preserved.
**Local URL:** http://127.0.0.1:5173/ (`cd clinic-ops-admin && npm run dev -- --host 127.0.0.1`).

## Ready for retest

| # | Finding | Status |
| --- | --- | --- |
| P0 | Workflow chronology | **Fixed and regression-tested.** Enforced in the domain layer. |
| P1 | Owner exception actions and role switching | **Fixed and regression-tested** |
| P1 | Owner order status | **Fixed and regression-tested.** Root cause found in the line allocation (below). |
| P2 | Stale error after a corrected post | **Fixed and regression-tested** |
| #5 (live retest) | Module shortcuts linked to forbidden pages | **Fixed and regression-tested** (§8) |
| #6 (live retest, blocker) | Immediate same-minute receipt rejected | **Fixed and regression-tested** (§8) |
| #7 | Duplicate recall recipients | **Not addressed in this pass** (§8) |

The independent live retest by Codex passed:
- the 17-step 10,020 kg replay;
- all three owner hand-offs;
- held-stock reallocation;
- delivery status;
- correction feedback.

**Commands, run from `clinic-ops-admin/` (latest run, after the retest fixes):**

| Command | Result |
| --- | --- |
| `npx tsc -b --noEmit` (same as `npm run typecheck`) | Clean |
| `npm run test` | **19 files, 197 tests passing.** Includes 15 tests in `rentio-acceptance2.test.tsx`, 8 new in `rentio-acceptance2-retest.test.tsx`, and an existing `rentio-recall.test.tsx` that I did not author or change |
| `npm run build` | Passes; the existing >500 kB chunk warning remains |

**Not performed in the first round-2 session** (the later live retest was done independently by Codex):
- **Live browser retest.** Network and browser commands (curl, launching Chrome) required interactive approval, so the headless-Chrome tour in `docs/rentio/review-round-1/scripts/` was not re-run.
- **Dev server check.** Its state was not confirmed (the background process from the earlier session had stopped).
- **What this means:** the UI behaviour below is verified by jsdom tests that render the full app (`<App />`) only. Treat a live browser retest as outstanding.

## 1. P0 — workflow chronology (AC-02/03, WF-03/04)

- **Reproduced in source.** `engine.move()` checked only the current balance, never the balance at the entered event time.
  - An issue dated before the output existed (the HO-0023 case) was therefore accepted, as were receipts dated before the issue and starts dated before the receipt.
  - Future event times were also accepted. In the reported case, the finish was recorded at 08:25 IST while the wall clock was about 06:31.
- **Fix, in the domain layer:**

  | Change | Where |
  | --- | --- |
  | `checkChronology(lot, location, qty, at)` runs on every outbound movement: the quantity must exist at the entered time, later recorded movements must stay non-negative, and timestamp ties keep posting order | `engine.ts` |
  | Fungible positions with several receipts count everything that had arrived by the entered time, so earlier eligible quantity is never blocked | `engine.ts` |
  | Covers the whole chain: output availability → issue → receipt → start; also intake acceptance, transfers, dispatch and by-product use | `engine.ts` |
  | `checkAfter` enforces run event order: start → hold → resume → finish | `ops.ts` |
  | Future event times (more than 5 min ahead) and invalid times are refused | `execute`, `engine.ts` |
  | Errors read "Time not possible … Earliest allowed time: 25 Nov, 08:25 IST" | `engine.ts` |
  | Refusals are atomic: nothing posts | `commitDraft` |
  | Equal timestamps are allowed | `engine.ts` |
  | Every stage form (Receive, Start, Record output, Issue, Hold, Resume) prefills a valid time (now, or the earliest allowed if later), shows "Earliest allowed: … IST · not in the future", and limits the picker | `StageWork.tsx`, `ui.tsx` (`datetime` min/max) |
  | An empty or invalid time entry now gets a validation message instead of a crash | `ui.tsx` (`fromLocalInput`) |
  | The runner continues after manual work; it never back-dates | `scenario.ts` (`fitAt`) |
  | `rentio.test.ts` uses the real clock: its fixed "now" was ahead of the wall clock and is correctly refused | `rentio.test.ts` |

- **Tests:**
  - Receipt before issue is refused, atomically, and names the earliest time.
  - Start before receipt, hold before start, and finish before start are refused.
  - A back-dated issue before the output existed is refused; the same issue at the output time is accepted.
  - A future time is refused.
  - Fungible stock: 75 kg can leave between two receipts but 150 kg cannot; a back-dated 50 kg that would break a later record is refused, while 25 kg is accepted.
  - A valid full RT-001 replay still reconciles to 10,020 kg, and a manual cycle where all actions share one timestamp is accepted.
- **Routes:** `/o/rentio/w/plant1/production/stage?stage=OIL` and `/home/my-work` (as Anil Kumar).
- **Data setup:** demo snapshot; RT-003/G1 is waiting at Oiling.

## 2. P1 — owner exception actions and role switching (AC-03/13/17/21, FR-114/116/119)

- **Reproduced in source:**
  - Owner Home labelled delegated work with the operator's verb ("Reallocate", "Update ETA", "Settle shortfall") although the owner cannot perform it.
  - The focused record did not say who acts next.
  - Switching role while on a route the new role cannot open stranded the user on "No access".
  - The held order needed a manual Release followed by Reserve.
- **Fix:**
  - **Review CTA.** Every alert carries `actionCap` and `nextStep` (`views.ts`). `ctaFor()` shows the operator's action only to someone who holds that capability; otherwise the CTA reads **Review**, with "Next: Kiran Shah (Back Office): reallocate". This is used by Owner Home, Alerts and My work.
  - **Task banner.** Any record opened with `?focus=` gets a banner (`FocusTask` in `ui.tsx`, rendered by every page through `RPage`) stating:
    - the exact next step and named responsible person;
    - status, quantity, due time and escalation;
    - "Your next action" for the operator, or "Next action — delegated (you can review)" for others.
  - **Demo hand-off.** A clearly labelled **Demo hand-off: continue as <name>** button switches the simulated sign-in and keeps the operator on the same exact record (or opens their My work if they can't reach it). The owner never gains operational authority; every service re-checks capability.
  - **Role-switch landing.** An intentional switch from the account menu checks the current route with the same rules as navigation (`routeAllowed` in `AppShell.tsx`). If the new role can't open it, they land on their **My work**. Typed URLs and followed links are still guarded ("No access to this page").
  - **Held order.** New `reallocateAtRisk()` (`commerce.ts`) releases reservations on held or expired stock and re-reserves eligible stock in **one** transaction. If eligible stock is short, nothing changes. Holds are never touched. Orders & dispatch shows a primary **Reallocate held stock (500 kg)** button for Back Office, and Dispatch explains "Reserved stock is on hold — reallocate it first".
- **Tests:**
  - CTAs: Review for the owner on the reallocate, ETA and shortfall alerts; the real action for Kiran, Suresh and Sunita.
  - Held order, end to end: Owner → order: banner is delegated, Reallocate is disabled → hand-off to Kiran → banner reads "Your next action" → reallocate. The order then reads *ready to dispatch*; the held MIG-0001/B1-PK lot is still held with 0 reserved, and RT-001/B1-PK is reserved instead.
  - Reallocation with insufficient stock is all-or-nothing, and is forbidden for the owner.
  - The Update ETA and Settle shortfall links show the named operator, and the hand-off is available.
  - Switching to Anil while on `/distribution/orders` lands on his My work (showing "Receive RT-003/G1"); opening that URL directly as Anil still shows "No access".
- **Routes:**
  - `/dashboard` (Owner)
  - `/distribution/orders?focus=SO-0001`
  - `/production/stage?focus=RUN-…&stage=CLEAN`
  - `/production/handovers?focus=HO-…`

## 3. P1 — owner order status (AC-07/08/14)

- **Reproduced in source. Root cause:**
  - **SO-0005 showed "in transit" though fully received.** `lineShare()` returned the share of only the **first** shipment line for an order line. SH-0003 carried one order line on two lines (stack S01 3,000 kg + S02 1,000 kg), so only 3,000 kg counted as received and 1,000 kg wrongly showed "in transit".
  - **SO-0002 showed "in transit" for a short receipt.** Its 25 kg is short under an open dispute, but no rule existed to show "disputed".
  - **Two different derivations.** Owner Home used its own status logic, while Orders & dispatch showed the raw `approved` flag.
- **Fix (`commerce.ts`):**
  - `lineShare` now sums every shipment line of the order line.
  - `lineBalance.inTransit` is the quantity **still physically in transit custody** (`lineShareAfter` plus transit positions). A new `settledOther` holds quantity settled by an approved decision.
  - A new shared **`orderStatus()`** derives the status from reservations, shipment outcomes, open disputes and remaining quantities:

    | Order state | Status shown |
    | --- | --- |
    | Order cancelled | Cancelled |
    | Awaiting a credit decision | Credit hold |
    | Planned demand only | Advance booking |
    | Reserved stock is held or expired | At risk |
    | Nothing reserved yet | Awaiting stock |
    | Some stock reserved, rest short | Partly allocated |
    | All open quantity reserved | Ready to dispatch |
    | Dispatched, still in transit | In transit — X kg |
    | Short in transit, open dispute | Disputed — X kg short |
    | Part received, rest still open | Partly delivered |
    | All received | Delivered (receipt confirmed) |
    | Shortfall settled by approval | Delivered — X kg shortfall settled |

  - The label never implies payment; the tooltip says payment is followed up separately in Accounts.
  - `OrderStatusChip` (`ui.tsx`) is the single renderer for Owner Home "Delivery promises", the Orders table and the order header.
- **Tests:**
  - **Fixtures:** the two-stack D01 shipment shows delivered 4,000 kg and in-transit 0, status *delivered*. SO for D02 A2 is *Disputed — 25 kg short*; D02 B1 *at risk*; D04 *credit hold*; D03 *advance*.
  - **Transitions:** an approved transit loss reads *Delivered — 25 kg shortfall settled*. A fresh order moves *ready to dispatch* → *In transit — 250 kg*.
  - **Consistency:** Owner Home and Orders & dispatch render the same status code for every fixture order, include `disputed`, and show no false `in_transit`.

## 4. P2 — recovery clarity

- **Reproduced:** the toast stack kept the earlier failure toast after a corrected successful post.
- **Fix:** a success toast now clears outstanding error and warning toasts (`ToastProvider`, `feedback.tsx`). Form input is still preserved on error: `ActionForm` keeps its values and shows "Not posted — nothing changed".
- **Tests:**
  - The toast probe: an error followed by a success leaves only the success.
  - Full app, as Anil: record output 2,970 + 6 kg oil (unbalanced) → refused with input kept and an error toast → correct to 2,976 → posted, and the old "Unbalanced" toast is gone.

## 5. Acceptance-criteria map (all 16 modules)

**Legend:**
- **Covered:** works in the local prototype with tests.
- **Partial:** a usable flow, with named gaps.
- **Not yet:** not built.
- **Prod-only:** needs production infrastructure, real integrations or a business pilot, so cannot be accepted in a browser prototype.

| Module | Acceptance criteria | Status in prototype | Not yet covered / production-only |
| --- | --- | --- | --- |
| M1 Masters & setup | AC-01, AC-16, AC-22 | Covered: masters grids, route versions, machine readiness | AC-16 cutover rehearsal **prod-only**; staffing readiness not modelled |
| M2 Procurement & intake | AC-01, AC-24, AC-27 | Covered: purchase → truck → independent check; partial receipt; bill match/dispute; receipt counted once | Real weighbridge/photo upload not built (references only) |
| M3 Grading | AC-02 | Covered: G1/G2 child lots, balance, re-grade maker-checker, chronology | — |
| M4 Production | AC-02, AC-03, AC-04, AC-22 | Covered: stages, rework, oil, holds, ETA revisions, **event-time chronology**. Partial: backup receipt works (Factory Head as backup) | AC-04 explicit packing-gap reconciliation case **not yet**; staffing blocker not modelled |
| M5 Godown | AC-06, AC-23 | Covered: stacks, capacity, transfers, treatment holds, counts, retained samples | Repacking (FR-103) **not yet** |
| M6 Inventory | AC-05, AC-06, AC-23, AC-25, AC-27 | Covered: separate dimensions, FEFO, expiry, holds to descendants, by-products | True concurrent users **prod-only** (single-tab atomic) |
| M7 Dispatch | AC-06, AC-08, AC-25 | Covered: reservation, **atomic reallocation of held reservations**, dispatch weight check, transit, **derived order status** | Multi-stop trip proof (FR-112) **not yet** |
| M8 Distributors (17) | AC-07, AC-08 | Covered: good/damaged/short/excess receipt, retail delivery once, outside sale, transfers, scope | Real mobile app **prod-only** |
| M9 Salesman | AC-09 | Covered (simulated device): offline queue survives reload, revalidated sync, conflicts | Native app restart on Android/iOS **prod-only** |
| M10 Tally & compliance | AC-05, AC-12, AC-24 | Covered (simulated): lookup-before-retry, one IRN, collections provisional | Live Tally/GSP **prod-only**; reversed or bounced collection only partial |
| M11 Returns | AC-10, AC-11 | Covered: held return, disposal approval, replacement and credit separate. Partial: recall trace + recall hold | Full recall case (notices, closure) **not yet** |
| M12 Logistics | AC-07, AC-25 | Covered: rate-card snapshot, vehicle change, freight match, transit settlement | Multi-stop delivery (FR-112) **not yet** |
| M13 Control Tower | AC-03, AC-13, AC-17, AC-21, AC-26 | Covered: decision-first owner view, **review CTAs and the focused next step**, timed escalation, scoped alerts, role-switch landing | Grouped incidents (FR-115) **not yet**; AC-21 30-case pilot **prod-only** (needs people) |
| M14 Reports | AC-04, AC-14, AC-27 | Covered: lot trace (10,020 kg), yields, provisional costing, period lock, audit export | Financial truth from Tally **prod-only** |
| M15 HR & payroll | AC-15 | Covered (demo rule): dedupe, overnight shift, versioned payroll with a different authorizer | PF/ESI statutory rules and bank file **prod-only** |
| M16 Season & forecast | AC-13, AC-22 | Covered: season factor, plan readiness (bags, equipment), baseline-gated forecast | Capacity-based ETA (OQ-12) **not yet** |
| Cross-cutting | AC-17, AC-18, AC-19, AC-20 | AC-17 covered locally (scope and route guards, self-approval) | Server enforcement, AC-18 recovery, AC-19 load/adoption and AC-20 go/no-go are all **prod-only** |

## 6. Prioritized blockers for the guided owner demo

1. **Independent live retest of P0–P2 in a browser.** Only automated jsdom evidence exists for this round (see the "Not performed" note at the top).
2. **The presenter machine's clock must be on or after 24 Nov 2026, 17:00 IST.** The RT-001 fixtures are dated 16–24 Nov and the engine now refuses future event times. With a wrong clock, seeding or the runner fails visibly; it never produces silent bad data.
3. **Keep the guided path on built behaviour.** Repacking (FR-103), multi-stop delivery (FR-112), grouped incidents (FR-115) and the full recall case are **not built**. None of them is on the scripted walkthrough.
4. **First viewport, unchanged:** owner decisions (credit override), then top risks with Review CTAs and the named operator, then the stock flow. The hand-off button is for demonstration only and is labelled that way.

Lower priority:
- Page filters are not kept in the URL.
- The bundle is >500 kB.
- Approval rule strings store requirement codes (they are hidden on display).

## 7. Files changed this round

- **Domain:**
  - `src/domain/rentio/engine.ts`: chronology, future-time guard, `earliestAvailable`, `fmtIst`.
  - `ops.ts`: run event order.
  - `commerce.ts`: `lineShare` fix, `lineShareAfter`, `orderStatus`, `reallocateAtRisk`.
  - `views.ts`: `actionCap`, `nextStep`, `ctaFor`.
  - `scenario.ts`: `fitAt`.
- **UI:**
  - `src/rentio/ui.tsx`: `FocusTask`, `OrderStatusChip`, datetime bounds, safe `fromLocalInput`.
  - `pages/StageWork.tsx`: earliest-allowed times, prefill, `TimeInput`.
  - `pages/ControlTower.tsx`, `pages/Orders.tsx`, `pages/Alerts.tsx`, `pages/MyWork.tsx`.
  - `src/styles/rentio.css`.
- **Shell and primitives:**
  - `src/components/shell/AppShell.tsx`: `routeAllowed`, role-switch landing.
  - `src/components/primitives/feedback.tsx`: success clears stale errors.
- **Tests:**
  - New: `src/test/rentio-acceptance2.test.tsx`.
  - Updated: `src/test/rentio.test.ts` (real clock).

## 8. Live-retest findings #5–#7

### #6 (P0 retest blocker) — immediate same-minute raw handover

- **Reproduced in source:**
  - A godown issue has no time control, so it is stamped at the exact current second (e.g. 06:43:37).
  - The receipt form's time picker has minute precision, so `fromLocalInput` turned the default 06:43 into 06:43:00, which is before the issue.
  - Strict chronology then refused it. The message also showed minutes only, so it read as "06:43 is before 06:43".
- **Fix (the service rule is unchanged):**
  - **Minute resolution.** New `fromLocalInputAfter(value, earliest)` in `ui.tsx`: when the chosen minute **contains** the predecessor instant, the event resolves to exactly that instant. It is still not before the predecessor, so ordering stays strict and nobody has to wait for the next minute. An earlier minute is left as entered, and the service refuses it as before.
  - **Where it applies.** Every stage-form submit with a predecessor (Receive, Start, Record output, Issue, Hold, Resume in `StageWork.tsx`, which My work reuses) uses it.
  - **Seconds in messages.** IST time formatting in error messages and in "Earliest allowed" help now shows seconds whenever the instant has them, and the help adds: "choosing that minute records exactly this time" (`engine.ts` `istFmt`, `StageWork.tsx` `timeHelp`).
  - **No NaN.** `num()` never returns NaN, and `fmtKg` renders "— kg" for a non-finite value, so a half-loaded form cannot show "NaN kg". A clean render shows the prefilled outstanding quantity.
- **Tests** (`src/test/rentio-acceptance2-retest.test.tsx`):
  - **Minute resolution (unit):** a minute containing the predecessor resolves to the predecessor; previous and later minutes are unchanged; empty input is invalid.
  - **Domain:** Ravi issues RT-004 at HH:mm:37. A previous-minute receipt is refused atomically, and a future one is refused. The default same-minute receipt is accepted at exactly 06:43:37-style time, and the run start in the same minute is accepted too.
  - **Full app, frozen at HH:mm:50:**
    - Ravi's issue is posted at :37. Suresh opens My work → Receive RT-004.
    - The preview shows "Receive now 5,000 kg" with no NaN, and the help shows ":37 IST".
    - The picker defaults to the issue minute, and **Confirm receipt is accepted**, stamped at the issue instant.
  - **Full app:** choosing the previous minute shows "Time not possible", keeps the entered value, and posts nothing.
- **Route:** `/o/rentio/w/plant1/stock/godowns` (Ravi) → `/home/my-work` (Suresh). **Data:** fresh demo snapshot (RT-004 raw, 5,000 kg in R1).

### #5 (P1) — module landing routes

- **Reproduced in source.** The rail and the compact/mobile module list both linked each module to its first resource or first page, without a permission check:
  - Dinesh (D01) got `/distribution/orders` and `/sales/salesman`, both forbidden.
  - The rail's work-queue button pointed at the clinic route `work/inbox`, as did the notification popover footer.
- **Fix (`AppShell.tsx`):**
  - New `moduleLanding(actor, module)` returns the first page or resource the role may open, in sidebar order. It is used by both the rail and the mobile/compact module list.
  - The Home shortcut goes to the owner overview for roles that can see it, otherwise to My work.
  - In Rentio, the work-queue button and the notification footer open **My work**.
  - Direct-URL guards are unchanged: typing `/distribution/orders` as D01 still shows "No access to this page".
- **Tests:**

  | Role | Shortcut | Lands on |
  | --- | --- | --- |
  | D01, D02 | Dispatch & distributors | `distribution/distributors` |
  | D01, D02 | Sales & returns | `sales/returns` |
  | D01, D02 | Home | `home/my-work` |
  | Owner | Dispatch & distributors | Orders (default kept) |
  | Owner | Home | Owner overview (default kept) |
  | Salesman | Sales & returns | Salesman app (default kept) |

  - **Every rail shortcut for all 12 demo users** opens without "No access" or "Page not found".
  - **D01 clicks through:** Dispatch & distributors shows own stock (Shree Ganesh), with no Konkan/D02 stock and no "No access"; Sales & returns opens Returns. A direct `/distribution/orders` is still denied.
  - **Rail "My work" button** opens `/home/my-work`.
- **Limit:** the mobile module list is checked through the shared `moduleLanding` function (unit-tested). It was not rendered at phone width in jsdom.

### #7 (P1) — duplicate recall recipients: not addressed in this pass

- Added to the handoff after this pass was requested. The request was to keep this pass focused on #5 and #6, so recall code was not changed.
- The working tree already contains `src/test/rentio-recall.test.tsx`, which this session did not author. It passes in the latest run.
