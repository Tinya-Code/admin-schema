# Workflow Transitions Specification

## Purpose

Engine-enforced declarative state transitions on select fields, wired for `orders.status` and `auth_state`, with terminal-state semantics.

## Requirements

### Requirement: Declarative Transition Enforcement

The engine MUST enforce per-field transition graphs declared in the resource schema for select fields. Updates that violate the graph MUST fail closed with HTTP 409. Field writes targeting a field WITHOUT declared transitions MUST be unaffected. Create operations MUST NOT be transition-checked (no prior state exists).

#### Scenario: Legal transition succeeds

- GIVEN an order with `status = "PENDIENTE"`
- WHEN the API receives an update setting `status = "ENTREGADO"`
- THEN the update succeeds and the record persists `status = "ENTREGADO"`

#### Scenario: Illegal transition fails closed with 409

- GIVEN an order with `status = "PENDIENTE"`
- WHEN the API receives an update setting `status` to a value outside its legal transitions
- THEN the update is rejected with HTTP 409
- AND no partial write occurs

#### Scenario: Terminal state rejects outgoing transitions

- GIVEN an order with `status = "ENTREGADO"` (terminal)
- WHEN the API receives any update changing `status` to a different value
- THEN the update is rejected with HTTP 409

#### Scenario: Create is exempt from transition checks

- GIVEN a new order created with any value valid in the `status` enum
- WHEN the create request completes
- THEN the record is created successfully regardless of transition rules

### Requirement: orders.status Transition Graph

The system MUST apply: `PENDIENTE → {ENTREGADO, CANCELADO}`, `CANCELADO → PENDIENTE` (reversible), `ENTREGADO` terminal.

#### Scenario: CANCELADO is reversible

- GIVEN an order with `status = "CANCELADO"`
- WHEN the API receives an update setting `status = "PENDIENTE"`
- THEN the update succeeds

#### Scenario: PENDIENTE cannot jump to itself as a transition target

- GIVEN an order with `status = "PENDIENTE"`
- WHEN the API receives an update setting `status = "PENDIENTE"` with no other field changes
- THEN no transition violation is reported and no history entry is recorded

### Requirement: auth_state Transition Graph

The system MUST apply `auth_state` transitions: `ACTIVA → REVOCADA`; `REVOCADA` terminal. This applies to the `users` resource.

#### Scenario: Revocation succeeds

- GIVEN a user with `auth_state = "ACTIVA"`
- WHEN the API receives an update setting `auth_state = "REVOCADA"`
- THEN the update succeeds

#### Scenario: REVOCADA is terminal

- GIVEN a user with `auth_state = "REVOCADA"`
- WHEN the API receives an update setting `auth_state = "ACTIVA"`
- THEN the update is rejected with HTTP 409

### Requirement: Startup Registry Validation

The registry validator MUST reject resources whose declared transition targets are not members of the field's enum, at startup, before serving requests.

#### Scenario: Invalid transition target fails startup validation

- GIVEN a resource declares a transition to a value absent from the field enum
- WHEN the registry validator runs
- THEN validation fails with a descriptive error and the process does not serve requests
