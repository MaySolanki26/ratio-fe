# Shared Components & User Experiences
## Foundational components
Accessible Button, Input, Select, Tooltip, Menu, Dialog, Drawer, Popover, Toast, Badge, Avatar, Empty/Loading/Error state, DatePicker, Breadcrumbs and command controls. Overlay stacking, anchoring/flip, focus restoration, keyboard model and hit targets must be tested.

## Universal View Bar & Data Grid
- Underline-based view tabs (38-42px), always-visible `+`, personal/team/org view ownership, reorder/rename/pin/share/default/duplicate, deep links.
- TanStack Table + virtualization is a *recommended option* for large grids, not a mandate to migrate a working table. Server sort/filter/group/aggregate/export for large datasets. Sticky permission-aware View/Edit/More actions; columns persist per view/user.
- Advanced AND/OR filter builder, quick chips, relative dates; validate server-side; filterable fields from metadata.
- Cell renderer registry: typed values and compound cells; seven row patterns: dense, two-line, rich, tree, grouped, master-detail, responsive/mobile. Avoid forcing every resource into the same row presentation.

## Record Inspector
Nonmodal ~480px quick peek/edit/full detail, expandable, with Details/Related/Activity/Comments tabs. Single persistent collapsed Quick Comment composer at bottom of **every tab**; Comments tab must not duplicate it. Previous/next record, keyboard navigation, deep link, autosaved or warned drafts according to policy.

## Search, Notifications & Help
Command/Ctrl+K global/contextual search: authorized pages, records, views/actions, recents, exact IDs, safe deep links. Bell notifications and actionable Work Inbox are distinct from audit and approval states. Help registry binds page/resource/field/action to documentation; role-adaptive tours and EDA-verified onboarding milestones.

## Dashboards and Reporting
Operational and analytical dashboards, permission-safe semantic measures, report builder, widgets, saved responsive layouts, drilldowns, exports and freshness. Do not copy transaction logic into chart components.

**Every dashboard follows SKILL.md rule 100** (tabbed analytics dashboard). Build it in this order:
1. **Model first** — one `buildDashData(actor, scope, filters)` that reads only permitted resources and returns the period window, the compared window, the filtered rows, `delta(now, before)` and the trend buckets. Tabs only *derive* figures from it; chart components only *draw* what they are given.
2. **Tabs per area** — Overview (headline KPIs, conversion funnel + status donut, running-total trend + Needs attention, Up next list) plus one tab per business area (e.g. scheduling/operations, people/registry, money/billing). Hide a tab the actor cannot read; keep the tab in the URL.
3. **KPI row** — 4–6 `StatCard`s per tab, each answering one question ("How many?", "How well?", "What is waiting?", "What is late?"), with a delta vs the compared period where a period applies and a link to the matching list.
4. **Chart cards by job** — conversion → funnel; status mix → donut; top-N mix → pie; parts of a whole → waffle; trend → running-total area lines; magnitude / age buckets → columns (attention buckets amber/red); two-part ranking → split bars; utilisation → progress rows; exceptions → Needs attention list. Pair cards so row-mates have similar heights; no card left mostly empty; empty data → a one-line muted message, never a blank chart.
5. **Check** at 390 / 900 / 1280 / 1440 / 1920px with reduced motion on (final values visible) and off (entrance motion), in light and dark themes, and for a restricted role (finance hidden, masked names).

## Soft Enterprise UI quality
Readable in compact density, status communicated by icon/text in addition to color, focus visible, high contrast, screen reader announcements, responsive list alternatives, popovers that do not clip, helpful skeleton/empty/error states. Every visible action real, disabled with explanation, or labeled demo-only.
