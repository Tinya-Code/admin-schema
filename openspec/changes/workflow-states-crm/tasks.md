# Tasks: Workflow States & CRM-by-Schema Completion

Strict TDD: every task runs its RED test-first step before the GREEN step. Back `npm run test:api`; front `npx ng test --watch=false`.

## Slice 1 — Back engine + schema (PR 1, base = main)

- [ ] S1.0 Fix delta specs `users`→`orders` for `auth_state` (`specs/workflow-transitions/spec.md`, `specs/state-history/spec.md`). Test: n/a. Gate: `rg 'users' specs/` — no auth_state-on-users left. ~5
- [ ] S1.1 RED `api/__tests__/state-history.spec.js`: legal change appends `{from,to,at,actor}`; none on 409/same-value/unmanaged/create; fail-loud 500 missing sheet. Impl: none. Gate: `npm run test:api` (red). ~80
- [ ] S1.2 GREEN `api/engine/31-history.js`: `appendHistoryRows_`; actor `user.email` (Session fallback, 50-audit). Gate: `npm run test:api`. ~50
- [ ] S1.3 GREEN `api/engine/24-crud.js`: call in `updateCollection_`/`updateSingleton_` in-lock post-write beside `auditWrite_` (D1); skip `from==to`. Gate: `npm run test:api`. ~15
- [ ] S1.4 `api/setup/02-setup-sheets.js`: sheet spec `[key, field, from, to, at, actor]` (D2). Gate: `npm run test:api`. ~8
- [ ] S1.5 RED `api/__tests__/validate-registry.spec.js`: `history` (sheet ≠ resource/child, fields exist), `states` (keys ⊆ enum, tone ∈ TONE), bad tone rejected. Gate: `npm run test:api` (red). ~40
- [ ] S1.6 GREEN `api/schema/validate-registry.js`: `+'history'` resource key, `+'states'` field key, `validateHistory_`, `validateStates_` (D7 vocab). Gate: `npm run test:api`. ~60
- [ ] S1.7 RED `api/__tests__/transitions.spec.js`: orders `auth_state` incl fail-closed source `NINGUNO→{ACTIVA}` (else public PIN-verify 409s), `ACTIVA→{REVOCADA}`, terminal `REVOCADA` (D3). Gate: `npm run test:api` (red). ~30
- [ ] S1.8 GREEN `api/schema/resources/orders.js`: both graphs (incl `NINGUNO→ACTIVA`), `states` per field, `history: { sheet: 'order_state_history', fields: ['status','auth_state'] }`. Gate: `npm run test:api`. ~45

## Slice 2 — Projection + contract + front mirror (PR 2, base = PR 1 branch)

- [ ] S2.1 RED drift test: omitted/corrupted front `transitions`/`history`/`states` key fails naming it. GREEN `api/capabilities/handlers/schema.js`: project 3 keys (`states` via `PROJECTED_SCALAR_KEYS`, D4); `scripts/contract-check.mjs`: deep-compare + TONE↔BadgeKind text compare (D7). Gate: `npm run api:check`. ~120
- [ ] S2.2 GREEN `src/app/schemas/schema.model.ts` types + `src/app/schemas/orders.schema.ts` mirror of 3 keys. Gate: `npm run api:check && npx tsc -p tsconfig.app.json --noEmit`. ~70

## Slice 3 — Front UX (PR 3, base = PR 2 branch)

- [ ] S3.1 RED `select/transitions.spec.ts`: `legalOptions(field, transitions, base)` — legal next minus base; terminal ⇒ base only; none ⇒ full enum. GREEN `src/app/fields/select/transitions.ts` pure fn. Gate: `npx ng test --watch=false`. ~70
- [ ] S3.2 `record` in `RenderContext` + plumbing: `render-registry.ts`, `field-host.ts`, `form-view.ts`, `drawer-form.ts`, `render-host.ts` (group/list child ctx; D5 original value via `loadedRecord`). Gate: `npx tsc -p tsconfig.app.json --noEmit`. ~30
- [ ] S3.3 RED `select.spec.ts`: filter by ORIGINAL record (create = full enum, D5); terminal ⇒ base appended `disabled`, radios `[disabled]` (D6); no-transitions unchanged. GREEN `select.ts` + radio-mode + `select.descriptor.ts` (pass resource/record). Gate: `npx ng test --watch=false`. ~110
- [ ] S3.4 RED `display.spec.ts`: schema `states` tone/label wins; absent ⇒ `resolveBadgeKind` fallback identical. GREEN `display-badge.ts` + `columns/format-badge.ts`. Gate: `npx ng test --watch=false`. ~70
- [ ] S3.5 VERIFY only: generic child-sheet already renders engine-owned history sheet? Only if NOT: minimal `state_history` field `hiddenOn: 'update'` in `orders.schema.ts` (display-only, never round-tripped). Gate: `npx ng test --watch=false`. ~0–60

Per-PR gate: `npx ng test --watch=false && npm run test:api && npm run api:check`; PR 3 adds `npm run build`.

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

| Field | Value |
|-------|-------|
| Estimated changed lines | ~800–890 total (PR1 ≈330, PR2 ≈190, PR3 ≈300–360) |
| Delivery strategy | auto-chain |
| Size:exception | Not needed — each slice < 400 authored lines |

| Unit | PR | Focused test command | Runtime harness | Rollback boundary |
|------|----|----------------------|-----------------|-------------------|
| Back engine + schema | PR 1 | `npm run test:api` | `scripts/api-regression.sh` optional (needs `.gas-smoke.env`); else N/A (GAS deploy) | Revert removes writer/setup/validate/orders config; additive, old front unaffected |
| Projection + mirror | PR 2 | `npm run api:check` | N/A — static contract check is the proof | Revert removes projection + front types; back untouched |
| Front UX | PR 3 | `npx ng test --watch=false` | Manual drawer-form transition; optional smoke | Revert restores full-enum selects + fallback badges |
