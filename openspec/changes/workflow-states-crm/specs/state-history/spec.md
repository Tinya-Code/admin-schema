# State History Specification

## Purpose

Automatic, append-only audit history for transitions-managed field changes, driven by resource schema config `history: { sheet, fields }`.

## Requirements

### Requirement: Automatic History Append

When a resource declares `history: { sheet, fields }`, the engine MUST append one history entry for each managed field whose value changed, recording from-value, to-value, timestamp (`at`), and actor. History MUST be written as part of the same logical update; a failed update MUST NOT leave a history entry.

#### Scenario: Managed field change appends history entry

- GIVEN an order with `history` configured for the `status` field and `status = "PENDIENTE"`
- WHEN an update legally transitions `status` to `"ENTREGADO"`
- THEN one history entry is appended with `from = "PENDIENTE"`, `to = "ENTREGADO"`, a non-empty `at`, and the acting user as `actor`

#### Scenario: Failed transition writes no history

- GIVEN the same order in `status = "PENDIENTE"`
- WHEN an update attempts an illegal `status` change (rejected with 409)
- THEN no history entry is appended

### Requirement: No History for Unmanaged Fields

Fields not listed in `history.fields`, and resources without a `history` config, MUST NOT produce history entries.

#### Scenario: Unmanaged field change records nothing

- GIVEN an order with `history.fields = ["status"]`
- WHEN an update changes only a non-listed field (e.g. `customerName`)
- THEN no history entry is appended

#### Scenario: Resource without history config is untouched

- GIVEN a resource with no `history` configuration
- WHEN any field on it is updated legally
- THEN no history sheet writes occur

### Requirement: History Is Append-Only

History rows MUST never be updated or deleted through the normal update/delete API surface; the append-only invariant check MUST remain in force.

#### Scenario: Attempted history row mutation is rejected

- GIVEN a history sheet with at least one entry
- WHEN an update or delete request targets a history row
- THEN the request is rejected and the row is unchanged
