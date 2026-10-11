# Design: Workflow States & CRM-by-Schema Completion

## Technical Approach

Wire the existing transitions engine (`api/engine/29-transitions.js`) for `orders.status`/`auth_state`; add a generic history writer (`api/engine/31-history.js`) in the in-lock update path after the row write; project `transitions`/`history`/`states` to the front (`projectResourceSchema_` + contract-check); consume them for badge tones and legal-option pre-filtering. No domain branches (mejoras §11).

## Architecture Decisions

| # | Options | Tradeoff | Decision |
|---|---------|----------|----------|
| D1 | Writer in `validateAndThrow_` vs update flow | Runs twice pre-write → double/early append | `updateCollection_`/`updateSingleton_`, **in-lock post-write** beside `auditWrite_`; skip `from==to` (criterion of `assertTransitions_`): failed update or same-value ⇒ no entry |
| D2 | Reuse child `order_history` vs own sheet | Child is round-tripped by the front: stale form 422 via `history-append-only`; `writeChildren_` rewrites engine columns | Engine-owned sheet (`history: { sheet, fields }`) from `getSheetSpecs_`; append-only by construction; child + check untouched |
| D3 | auth_state on `users` (spec) vs `orders` | `users.js` lacks the field; validator rejects it | Wire **orders** + missing fail-closed source (default `NINGUNO` would be stuck): `NINGUNO→{ACTIVA}`, `ACTIVA→{REVOCADA}`, `REVOCADA→{REVOCADA}` (A2) |
| D4 | Keys on fields vs resource mirror | Field-level eases FieldSelect; diverges from back | Mirror 1:1: `transitions`+`history` resource-level; `states` per field (`PROJECTED_SCALAR_KEYS`); FieldSelect uses `getSchema(ctx.resource)` |
| D5 | Filter by live value vs original record | Live re-filters after each pick → radio empties; can't switch choice | Filter by **original record value**: `RenderContext` gains `record` (form-view/drawer-form `loadedRecord`); create/no-record ⇒ full enum |
| D6 | Drop current value vs disabled option | Dropping leaves blank `<select>` (violates guide §1) | Options = `transitions[base] ?? []` minus `base`; append `base` as `disabled` if absent (terminal ⇒ one disabled option, spec's "disabled or empty"); radios gain `[disabled]` |
| D7 | Free tones vs vocabulary | Drift vs front `BadgeKind` | Back TONE = front `BadgeKind` (`success danger warning info neutral`); validator rejects others; contract-check text-compares both (validator-vocabulary precedent) |

## Data Flow

    PUT /admin/orders/{ref}
      → pre-lock validate + assertTransitions_ (409 ⇒ nothing)           [unchanged]
      → withPolicyLock_: re-read, validateAndThrow_ (422 → 409)          [unchanged]
      → write row + children                                             [unchanged]
      → appendHistoryRows_(ss, resource, key, current, payload, user)    [NEW]
            per f in history.fields with String(current[f])≠String(payload[f]):
              appendRow(history.sheet, {key, field:f, from, to, at, actor})
      → auditWrite_ / cacheInvalidate_ / afterUpdate / emitStatusChange_ [unchanged]

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `api/engine/31-history.js` | Create | `appendHistoryRows_`; actor `user.email` (Session fallback, `50-audit`); fail-loud 500 on missing sheet/column |
| `api/engine/24-crud.js` | Modify | Writer calls in both update paths (in-lock, post-write) |
| `api/setup/02-setup-sheets.js` | Modify | History sheet spec `[key, field, from, to, at, actor]` |
| `api/schema/validate-registry.js` | Modify | `+'history'` resource key, `+'states'` field key; `validateHistory_` (sheet ≠ resource/child sheet, fields exist); `validateStates_` (keys ⊆ enum, tone ∈ TONE) |
| `api/schema/resources/orders.js` | Modify | Both transition graphs, `states`, `history: { sheet: 'order_state_history', fields: ['status','auth_state'] }` |
| `api/capabilities/handlers/schema.js`, `scripts/contract-check.mjs` | Modify | Project 3 keys; deep-compare (name drifted key); TONE↔BadgeKind |
| `schema.model.ts`, `orders.schema.ts` | Modify | Types + hand-mirrors of the 3 keys |
| `render-registry.ts`, `field-host.ts`, `form-view.ts`, `drawer-form.ts`, `render-host.ts` | Modify | `record` in `RenderContext` + plumbing (incl. group/list child ctx) |
| `fields/select/transitions.ts` | Create | Pure `legalOptions(field, transitions, base)` |
| `select.ts`, `radio-mode`, `select.descriptor.ts` | Modify | Filter; `[disabled]` on radios; descriptor inputs pass `resource`/`record` |
| `display-badge.ts`, `columns/format-badge.ts` | Modify | `states[value].tone/label`, `resolveBadgeKind`/option-label fallback |

## Interfaces / Contracts

```js
// api/schema/resources/orders.js (instance)
transitions: {
  status: { PENDIENTE: ['ENTREGADO','CANCELADO'], ENTREGADO: ['ENTREGADO'], CANCELADO: ['PENDIENTE'] },
  auth_state: { NINGUNO: ['ACTIVA'], ACTIVA: ['REVOCADA'], REVOCADA: ['REVOCADA'] },
},
history: { sheet: 'order_state_history', fields: ['status','auth_state'] },
// fields.status gains states: { PENDIENTE:{ label:'Pendiente', tone:'warning' }, … }
// Sheet row: [order_ref, field, from, to, at, actor] — engine-owned, append-only
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Back | Append on legal change (from/to/at/actor); none on 409/same-value/unmanaged/create; fail-loud missing sheet | New `api/__tests__/state-history.spec.js` (pattern of `transitions.spec.js`) |
| Back | Registry history/states shapes, TONE, sheet ≠ child | Extend `transitions.spec.js`, `validate-registry.spec.js` |
| Contract | Drift on any key fails naming it | `npm run api:check` (+ corruption exercise in apply) |
| Front | `legalOptions` matrix; FieldSelect filtering (offers, terminal disabled, unchanged w/o transitions); badge tone + fallback | New `transitions.spec.ts`; extend `select.spec.ts`, `display.spec.ts` |
| Smoke | Real transition + history row + 409 | `scripts/api-regression.sh` (optional) |

## PR Slicing (auto-chain, 800-line budget)

1. **Back engine + schema**: `31-history.js`, `24-crud.js`, `02-setup-sheets.js`, validate-registry, orders.js + back tests.
2. **Projection + contract + front mirror**: schema.js, contract-check, `schema.model.ts`, `orders.schema.ts`; `api:check` green (each slice standalone-green: slice 1 adds no projection).
3. **Front UX**: `record` plumbing, `transitions.ts`, select/radio filtering, badge states + front tests.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR, executable-file, or process-integration boundary; the writer is schema-driven Sheets appends inside the CRUD lock.

## Migration / Rollout

No migration; every enum value is a declared source → no stuck rows. Back first is safe (additive; old front unaffected — 409 interceptor maps); `setupSheets` after `clasp push` creates the sheet; `api:drift` green. Previously-free illegal transitions now 409 (accepted, D32). Backfill out of scope; rollback = revert + redeploy.

## Open Questions

- [ ] Spec bug: workflow-transitions targets `users`, but `auth_state` exists only on `orders` — amend delta wording before archive?
- [ ] `ACTIVA→NINGUNO` intentionally undeclared (A2 minimal) — confirm.
- [ ] Transition-history timeline deferred; candidate: `state_history` list field `hiddenOn: 'update'` (display-only, never round-tripped). Slice 3 or follow-up?
