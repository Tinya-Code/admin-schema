# Transitions-Aware Editing Specification

## Purpose

Edit forms offer only legal next states, derived from the record's current value and the schema transition graph; the server 409 remains as defense in depth.

## Requirements

### Requirement: Select Options Filtered by Legal Transitions

When a select field declares `transitions`, the edit form MUST offer only the legal next values from the record's current value (schema-first, via the projected front schema). Fields without `transitions` MUST offer the full enum, unchanged from today.

#### Scenario: PENDIENTE row offers only legal next states

- GIVEN an order row with `status = "PENDIENTE"` and transitions `PENDIENTE → {ENTREGADO, CANCELADO}`
- WHEN the edit form opens
- THEN the status select offers exactly `ENTREGADO` and `CANCELADO`
- AND `PENDIENTE` is not offered as a transition target

#### Scenario: Terminal state offers no alternatives

- GIVEN an order row with `status = "ENTREGADO"` (terminal)
- WHEN the edit form opens
- THEN the status select offers no alternative values (disabled or empty per existing select conventions)

#### Scenario: Field without transitions is unchanged

- GIVEN a record whose select field declares no `transitions`
- WHEN the edit form opens
- THEN the select offers the full enum, exactly as today

### Requirement: Stale Client 409 UX Unchanged

If a client submits an illegal transition anyway (stale form, concurrent change), the existing 409 interceptor mapping MUST surface the current error message; this change MUST NOT alter the interceptor text or behavior.

#### Scenario: Concurrent edit yields existing 409 message

- GIVEN two clients loaded the same order in `status = "PENDIENTE"`
- WHEN client A transitions to `"ENTREGADO"` and client B then submits `"CANCELADO"`
- THEN client B receives the existing 409 interceptor message (unchanged copy)
- AND the record remains `"ENTREGADO"` with a single history entry
