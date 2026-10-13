# Proposal: Declarative View Composition & Navigation (R9.9 / F12)

## Intent

Schemas can't declare composed experiences (list→detail, calendar/Kanban/list tabs) without engine domain knowledge, and only the router consumes the `kind:'view'` registry. Two SEPARATE `uiViews` mechanisms, no type `switch` in the composer:

- **Navigation/route**: changes location; keeps URL, guards, history (lista → detalle `:key`).
- **Embedded composition**: child view in the page; no route per panel (tabs).

## Scope

### In Scope

- Contracts: container (tabs), nav target, selection event, `ViewContext`; typed config, explicit refs, no `any`.
- Composer host: recursive, registry-driven, lazy, per-instance state, depth/cycle limits.
- Fail-loud pre-render validation: unknown types, broken refs, dup ids, cycles, depth.
- Plus R9.9.4–R9.9.7 (drill-down, tabs, actions/security, tests/docs).

### Out of Scope

- Backend `views`, new endpoints, resource names in engine.
- `layout.mode:'tabs'` (R9.2); `ResourcePage` `schema.kind` dispatch rewrite; CRUD-form duplication.

## Capabilities

### New Capabilities

- `view-composition`: container/tabs contract, composer host, `ViewContext`, validation, state isolation (R9.9.2/3/5).
- `view-navigation`: navigation-target contract, selection event, drill-down, guards/history, read-only default (R9.9.4/6).

### Modified Capabilities

None — `openspec/specs/` empty.

## Approach

Discriminated-union contracts in `core/models/schema.model.ts`; pure validator in tests + route build. Composer resolves children ONLY via `viewDescriptors` + `load()`; imports no leaf. `ViewContext` flows via the channel children receive (verified: route data, not `input.required`). Rows via `DataSourceService`; navigation via route builder + `roleGuard`. Outline: R9.9.2→R9.9.7, strict TDD.

## Affected Areas

| Area                                       | Impact       | Description                                     |
| ------------------------------------------ | ------------ | ----------------------------------------------- |
| `core/models/schema.model.ts`              | Modified     | Container/nav/selection/`ViewContext` contracts |
| `views/composer/` + `views/descriptors.ts` | New/Modified | Host + tabs descriptor                          |
| registry/schema validator                  | New          | Refs, cycles, depth checks                      |
| `shell/shell.routes.ts`                    | Modified     | Validate composition at build                   |
| `orders.schema.ts`, `doc/`                 | Modified/New | Fixture + docs                                  |

**Gates:** all five — `test` · `test:api` · `api:check` · `build` · `prettier --check` (front-only).

## Risks

| Risk                                              | Likelihood | Mitigation                              |
| ------------------------------------------------- | ---------- | --------------------------------------- |
| Composer grows domain `switch`                    | Med        | Descriptor-only; test: no leaf imports  |
| Child context broken (`loadComponent`, no inputs) | Med        | Typed `ViewContext` + integration tests |
| Runtime recursion/cycles                          | Med        | Pre-render validation + depth limit     |
| 800-line review budget exceeded                   | Med        | auto-chain per sub-task                 |

## Rollback Plan

Front-only, additive: revert chain commits or drop branch. No GAS deploy or migration; non-composed schemas behave as today.

## Dependencies

R9.8 (done), R9.9.1 (given); `DataSourceService`, `roleGuard`, registry; strict TDD.

## Success Criteria

- [ ] Fixture composes ≥3 heterogeneous leaves; composer imports none.
- [ ] Invalid schemas fail readably BEFORE render.
- [ ] list/calendar/kanban clicks share ONE selection contract; guards intact.
- [ ] Same-type instances coexist with isolated state.
- [ ] New leaf = zero composer/shell edits; five gates green.
