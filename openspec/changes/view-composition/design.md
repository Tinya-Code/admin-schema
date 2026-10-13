# Design: Declarative View Composition & Navigation (R9.9 / F12)

## Technical Approach

Additive change on top of the `kind:'view'` registry: a new `tabs` container descriptor mounts a recursive, registry-driven composer; selection/drill-down becomes one typed contract consumed through the route-data channel. All 14 requirements / 20 scenarios of both delta specs are covered. Contracts extend `UiViewDescriptor` (discriminated unions, no `any`); validation is one pure function; leaves keep reading `ActivatedRoute.data`.

## Architecture Decisions

### D1 — ViewContext channel (open question 1)

| Option                                                                                                      | Tradeoff                                                                                                                                                                       | Decision |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Synthetic `ActivatedRoute` per embedded child (`Injector.create` around `viewContainerRef.createComponent`) | Zero leaf rewrites; identical lookup route-mounted/embedded; existing spec harnesses (`{provide: ActivatedRoute, useValue:{data: of(...)}}`) keep passing; one documented cast | ✅       |
| New `VIEW_CONTEXT` DI token + migrate leaves                                                                | Clean DI but rewrites kanban/calendar/ResourcePage + tests; two channels forever                                                                                               | ❌       |
| Route helper `viewContext()`                                                                                | Leaves must migrate; dual-source ambiguity                                                                                                                                     | ❌       |

One factory `createViewContext()` builds the typed payload for BOTH producers: `shell/routes` (static flat keys + a `resolve: {viewContext}` resolver binding `emit` in injection context) and `ViewSlot` (synthetic route data = same payload). Embedded children also receive a **virtual schema** `{...schema, uiViews: {...schema.uiViews, [instanceId]: node}}` so the existing `schema.uiViews[route.uiView]` config lookup works unchanged. `instanceId = parentId + '/' + node.id` (unique per instance).

### D2 — Unknown-type ownership (open question 2)

Single owner: `composition-validator.ts` (pure, sync). It detects unknown types with registry `get('view', type)` — never `resolve()`. Call path: `resourceRoutes()` → `validateComposition(schema)` → `get('view','heatmap') === undefined` → `throw SchemaCompositionError("orders.panel → child 'cal': unknown type 'heatmap'")` at startup. At runtime, slots run only after validation returned zero issues and fetch via `get()` + `descriptor.load()` directly, so `resolve()`'s silent fallback is unreachable for compositions (unchanged for fields/widgets). The mount error state prints the same readable error; no fallback screen.

### D3 — Where validation runs (open question 3)

One owner function, TWO hooks: route build in `shell/routes` (startup fail-loud — the same place that already throws on unknown `uiViews` types) and a composer-mount guard (same function; renders the readable error pre-render). Route-build-only leaves non-route hosts (tests, future containers) unguarded; mount-only loses startup fail-loud. RED tests hit both hooks.

### D4 — Target load error recovery (view-navigation)

| Surface                               | Mechanism                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route-mounted detail/form fetch fails | reuse the existing error `app-empty-state` (message via `ErrorMapperService.map(...).general`) and add a `Volver` action beside `Reintentar`; while `status==='error'` detail hides header `Editar`/`Eliminar` — no actionable partial destination                                                                                                             |
| Embedded target (`ViewSlot`)          | no navigation occurred → the origin view stays mounted and interactive (the way back is inherent); per-child error state unchanged                                                                                                                                                                                                                             |
| Back action                           | `ViewNavigationService.back(returnPath)` → `router.navigate` to the declared return path (selection origin recorded by `dispatch`, else route-data `resourceId` root). Full navigation ⇒ guards run, browser history intact; rejected `Location.back()`-only (deep link/refresh ⇒ no in-app entry ⇒ exits the app) and message-only error states (no way back) |
| Diagnostics                           | raw error kept, mapped string is display-only: `FetchState` becomes `{phase:'error'; error: unknown}`, FormView `load()` stores the caught error instead of `catch {}`, `ViewSlot` keeps the rejection per `instanceId`                                                                                                                                        |

Rejected: new error component — `EmptyState`'s projected action slot is the established pattern (kanban/calendar/detail).

## Data Flow

```
mount:  route → ComposerHost → validateComposition → ViewSlot(node)
        → get('view',type) → load() → createComponent(injector: synthetic ActivatedRoute)
select: leaf → ctx.emit(event) → ViewNavigationService.dispatch(binding, event)
        → buildSegments(uiViews[target.view].path, {key}) → router.navigate → roleGuard
```

Rows always via `DataSourceService.rows` (cache keyed `resource|view|params` — incompatible configs ⇒ different keys); per-instance state (retention, selection) keys on `instanceId`.

## Decision table — click navigates vs inline (R9.9.4)

| Declared `select`            | Behavior                                     |
| ---------------------------- | -------------------------------------------- |
| absent                       | no navigation; leaf's current local behavior |
| `{on, mode:'route', target}` | encoded `router.navigate`; guards + history  |
| `{on, mode:'inline'}`        | local selection only                         |
| `{on, mode:'none'}`          | explicit no-op                               |
| raw/external URL             | validator rejects pre-render                 |

## File Changes

| File                                                               | Action        | Description                                                                                                                                            |
| ------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/models/schema.model.ts`                                      | Modify        | `ViewChildNode`, `UiViewTabs`/`TabsConfig`, `SelectionBinding`, `NavigationTarget`; `select?` on `UiViewBase`                                          |
| `core/registry/composition-validator.ts` + spec                    | Create        | dup ids, unknown types, broken refs, cycles, params, source existence, URL ban; `MAX_DEPTH=3`, `MAX_NODES=50`                                          |
| `views/composer/view-context.ts` + spec                            | Create        | `ViewContext`, `SelectionEvent`, factory, synthetic-route adapter                                                                                      |
| `views/composer/composer-host.ts`, `view-slot.ts` + specs          | Create        | recursive host (tablist a11y, depth guard, mount validation guard); lazy slot (per-child loading/error, teardown, retention map keep-only-if-`retain`) |
| `core/view-navigation/view-navigation.service.ts` + spec           | Create        | dispatch → target resolution, encoded segments, guard-preserving navigate; `back(returnPath)` declared-return-path fallback                            |
| `pages/detail-view/detail-view.ts`, `pages/form-view/form-view.ts` | Modify        | error state gains `Volver` (D4); raw error stored in `FetchState`/`load()` catch; detail header actions hidden on error                                |
| `shell/shell.routes.ts`                                            | Modify        | run validator; add `viewContext` resolver                                                                                                              |
| `views/descriptors.ts`                                             | Modify        | register lazy `tabs` descriptor                                                                                                                        |
| kanban/list/resource-page (+calendar emit)                         | Modify        | `ctx.emit` only when a binding is declared; else current behavior                                                                                      |
| `schemas/orders.schema.ts`, `doc/`                                 | Modify/Create | fixture (calendar/kanban/list tabs); route-vs-embedded + descriptor guide                                                                              |

## Contracts (key shapes)

```ts
type SelectionBinding =
  | { on: SelectionTrigger; mode: 'none' | 'inline' }
  | { on: SelectionTrigger; mode: 'route'; target: NavigationTarget };
interface NavigationTarget {
  resource: string;
  view: string;
  params?: string[];
}
interface SelectionEvent {
  resource: string;
  key: string;
  action: SelectionTrigger;
}
interface ViewContext {
  resourceId;
  uiView;
  viewType;
  instanceId;
  depth;
  schema?;
  selection?;
  emit?;
}
type ViewChildNode = (ViewChildBase & UiViewDescriptor) | (ViewChildBase & { ref: string });
// ViewChildBase: { id; label; retain?; visibleWhen?: FieldCondition[] } — refs make cycles possible → validator required
```

## Testing Strategy — strict TDD (RED first)

Runner: `npx ng test --include='<glob>'`; per-slice gates: `npm run test:api`, `npm run api:check`, `npm run build`, prettier.

| Layer           | What / How                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit            | validator per spec scenario + cycle/depth/URL/dup/unknown; `buildSegments` encoding (key `A/B`); dispatch blocked by guard                                                                                                                                                                                                                        |
| Integration     | composer with ≥3 heterogeneous fixture leaves; source-scan test: composer imports no leaf; per-child load-failure isolation; retention destroy vs keep; two same-type instances isolated; unauthorized child renders `unauthorized` without fetching                                                                                              |
| Recovery / race | detail/form fetch rejects → error `app-empty-state` shows message + `Volver`; click ⇒ `router.navigate` to return path (router spy); original error retained (identity assert); rapid-selection race via `loadEpoch` precedent (`views/kanban-view/kanban-view.ts:240`): out-of-order responses ⇒ only latest selection rendered per `instanceId` |
| Non-regression  | full front suite + back suite + contract-check                                                                                                                                                                                                                                                                                                    |

## Threat Matrix (routing boundary)

| Boundary                           | Applicable | Design response / RED test                                                                                   |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Nav target → route segments        | Yes        | validator rejects non resource+view targets; `buildSegments` encodes keys; no string concat (test key `A/B`) |
| Guards on composed navigation      | Yes        | no-permit dispatch → blocked, no record payload in URL                                                       |
| Write actions from composition     | Yes        | undeclared mutation fails closed (no navigate/persist)                                                       |
| Untrusted data in paths/templates  | Yes        | Router encoding only; no `innerHTML` in composer                                                             |
| Shell/subprocess/VCS/PR/exec-files | N/A        | no such boundary in this change                                                                              |

## Slice plan (auto-chain, ≤800 lines/PR)

1. Contracts + validator · 2. ViewContext factory + synthetic route + resolver · 3. Composer host + tabs descriptor · 4. Selection dispatch + leaf wiring · 5. Fixture + docs + full gates. Each slice: RED → GREEN → gates.

## Migration / Rollout

None: additive, front-only; non-composed schemas keep identical routes/behavior; `api:check` unaffected (`uiViews` is front-local).

## Open Questions

- Active-tab URL reflection (`queryParam` vs local): default local; decide on deep-link demand.
- Retention scope: component instance only (hidden); scroll/pagination persistence deferred.
