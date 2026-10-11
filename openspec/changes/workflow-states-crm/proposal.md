# Proposal: Workflow States & CRM-by-Schema Completion

## Intent

The declarative transitions engine (`api/engine/29-transitions.js`) is solid but unwired; the `history` sheet is never written; badge tones are a hardcoded vocabulary. Complete the workflow/state system and prove the declarative pattern so a CRM is constructible with zero domain code — only `api/schema/resources/*.js` + `src/app/schemas/*.ts`.

## Scope

### In Scope
- Wire `transitions` for `orders.status` and `auth_state` (existing engine, no contract change).
- Generic history writer: engine appends from→to (at, actor) for transitions-managed fields; append-only check stays.
- Declarative state metadata: per-option `label`/`tone`/`order` in schema; front schema-first with neutral fallback.
- Transitions-aware editing: select shows only legal next values from current record; existing 409 message kept.
- Document CRM pattern: pipeline = resource with a transitions-managed select.

### Out of Scope
Kanban/pipeline view; role-based transition permissions; transition side effects (email/webhooks); multi-step wizards; history backfill.

## Capabilities

### New Capabilities
- `workflow-transitions`: engine-enforced declarative transitions per select field; orders.status + auth_state wiring; terminal states.
- `state-history`: automatic append-only history for transitions-managed changes.
- `state-metadata`: per-option tone/label/order consumed by display/editing.
- `transitions-aware-editing`: legal-transition filtering of select options in edit forms.

### Modified Capabilities
None — `openspec/specs/` is empty (sdd-init).

## Approach

D32 defaults; each is a reviewable assumption:

| # | Assumption | Default |
|---|-----------|---------|
| A1 | status edges | PENDIENTE→{ENTREGADO,CANCELADO}; CANCELADO→PENDIENTE (reversible); ENTREGADO terminal |
| A2 | auth_state edges | ACTIVA→REVOCADA; REVOCADA terminal |
| A3 | history writer | resource config `history: { sheet, fields }`; engine appends on managed writes |
| A4 | metadata | optional per-field `states: { VALUE: { label, tone, order } }`; projected via contract-check; front falls back to today's mapping |
| A5 | 409 UX | unchanged interceptor message; form pre-filters illegal options |

## Affected Areas

| Area | Impact |
|------|--------|
| `api/engine/` (history writer, validate-registry.js) | Modified |
| `api/schema/resources/orders.js` | Modified (transitions/states/history) |
| `api/__tests__/` transitions + new history spec | Modified |
| `src/app/schemas/*.schema.ts`, `registry.ts`, `scripts/contract-check.mjs` | Modified (projection) |
| `src/app/fields/display/display-badge.ts`, edit select | Modified |
| `openspec/specs/{four new capabilities}` | New (sdd-spec) |

Gates affected: `api:check` (contract grows), `test:api`, `ng test`, `build`.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Transitions turn previously-free status writes into 409s | Med | Regression smoke; spec documents new rules |
| Contract drift on new schema keys | Med | Extend contract-check same change; api:check gate |
| GAS append latency | Low | One append per transition |

## Rollback Plan

Revert apply commits; redeploy GAS webapp + Vercel. Schema keys additive; resources without transitions/history config behave exactly as today.

## Dependencies

- Unchanged engine contract (409/fail-closed); sdd-spec creates the four new specs.

## Success Criteria

- [ ] Illegal managed change → 409; legal change → success + history entry (at, actor).
- [ ] Badges render schema tones (new CRM values not all-neutral); unmanaged resources unchanged.
- [ ] Edit form offers only legal next states.
- [ ] All gates green; a new pipeline resource definable with schema files only.

## Proposal question round

Auto mode: no blocking questions. For user review: (1) CANCELADO reversible? (2) ENTREGADO terminal? (3) include auth_state now (A2) or defer? (4) neutral fallback for missing tones OK?
