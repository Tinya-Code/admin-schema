# Tasks: Declarative View Composition & Navigation (R9.9 / F12)

Strict TDD (RED first); `src/app/` prefix; auto-chain → 5 stacked PRs.

## Slice 1 — Contracts + validator

- [x] 1.1 RED→GREEN `core/registry/composition-validator.ts` + `core/models/schema.model.ts` contracts (`ViewChildNode`, `UiViewTabs`, `SelectionBinding`, `NavigationTarget`, `select?`) [D2]; spec `composition-validator.spec.ts`: dup/missing id, unknown type (`get` not `resolve`), broken ref, cycle, depth>3, >50 nodes, params/source, raw URL → `SchemaCompositionError`. Test: `npx ng test --include='**/composition-validator.spec.ts'`.
- [x] 1.2 RED→GREEN `shell/shell.routes.ts` runs `validateComposition` at build; invalid throws at startup, valid routes unchanged [D3]. Test: `npx ng test --include='**/shell.routes.spec.ts'`.

## Slice 2 — ViewContext + resolver

- [x] 2.1 RED→GREEN `views/composer/view-context.ts`: typed `ViewContext`/`SelectionEvent`, no field `RenderContext`, virtual schema keyed `instanceId=parentId+'/'+node.id`; synthetic `ActivatedRoute` data, no `input.required`. Test: `npx ng test --include='**/view-context.spec.ts'`.
- [x] 2.2 RED→GREEN `shell.routes.ts` `resolve:{viewContext}` binds `emit` in injection context. Test: `npx ng test --include='**/shell.routes.spec.ts'`.

## Slice 3 — Composer host + tabs

- [x] 3.1 RED→GREEN `views/composer/composer-host.ts`: recursive, registry-only, no domain switch; spec: ordered ≥3 children via `load()`, `initial` selected, per-child loading/error, unknown type → readable error, mount+depth guards, tablist a11y. Test: `npx ng test --include='**/composer-host.spec.ts'`.
- [x] 3.2 RED→GREEN `views/composer/view-slot.ts` + lazy `tabs` descriptor in `views/descriptors.ts`; spec: load failure isolated per `instanceId`, undeclared retention destroyed + fresh remount, same-type isolated, unauthorized without fetching. Test: `npx ng test --include='**/view-slot.spec.ts'`.
- [x] 3.3 RED→GREEN `views/composer/composer-imports.spec.ts`: source scan — composer imports no leaf, no domain switch. Test: `npx ng test --include='**/composer-imports.spec.ts'`.

## Slice 4 — Dispatch + leaves + D4

- [x] 4.1 RED→GREEN `core/view-navigation/view-navigation.service.ts` (`dispatch`, `buildSegments`, `back`, key-only); spec: encoded key `A/B`, declared resource+view only, guard blocks (no payload), undeclared mutation fails closed, named action scoped, absent `select` inert, `back(returnPath)`. Test: `npx ng test --include='**/view-navigation.service.spec.ts'`.
- [x] 4.2 RED→GREEN kanban/list/resource-page/calendar emit only when `select` declared; out-of-order responses render latest per `instanceId`. Test: `npx ng test --include='**/kanban-view.spec.ts'`.
- [x] 4.3 RED→GREEN `pages/detail-view/detail-view.ts`, `pages/form-view/form-view.ts`: message + `Volver` navigate, raw error retained, header actions hidden [D4]. Test: `npx ng test --include='**/detail-view.spec.ts'`.

## Slice 5 — Fixture/docs/gates

- [x] 5.1 RED→GREEN tabs calendar/kanban/list fixture in `schemas/orders.schema.ts` + `view-composition.integration.spec.ts`: correct descriptors, nested tabs within depth, per-instance configs. Test: `npx ng test --include='**/view-composition.integration.spec.ts'`.
- [x] 5.2 RED→GREEN backward-compat non-regression: non-composed route set identical, row navigation unchanged, R9.8 configs unaffected. Test: `npx ng test --watch=false`.
- [x] 5.3 Docs `doc/`: route vs embedded, tabs contract, new-leaf registration. Test: `npx prettier --check .`.
- [x] 5.4 Gates: `npm test`, `npm run test:api`, `npm run api:check`, `npm run build`, `npx prettier --check .`.

Coverage: 14 reqs→1.1-5.2; R9.9.2→S1, R9.9.3→S2-3, R9.9.4→S4, R9.9.5→S3, R9.9.6→S3-4, R9.9.7→S5; D1→2.1, D2→1.1, D3→1.2+3.1, D4→4.3.

## Review Workload Forecast

Lines: S1 550, S2 300, S3 700, S4 750, S5 450, total ~2750 (≤800 each)

Harness: S1-S4 `npm run build`; S5 five gates. Rollbacks: S1 validator+schema.model+routes hook; S2 view-context+resolver; S3 views/composer+descriptors; S4 view-navigation+leaf emits+D4; S5 orders.schema+doc+integration spec.

- S1→PR1 contracts test `npx ng test --include='**/composition-validator.spec.ts'`
- S2→PR2 context test `npx ng test --include='**/view-context.spec.ts'`
- S3→PR3 composer test `npx ng test --include='**/composer-host.spec.ts'`
- S4→PR4 dispatch test `npx ng test --include='**/view-navigation.service.spec.ts'`
- S5→PR5 fixture test `npx ng test --watch=false`

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium
