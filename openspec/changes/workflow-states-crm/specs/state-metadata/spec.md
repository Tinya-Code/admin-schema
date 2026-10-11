# State Metadata Specification

## Purpose

Optional per-option display metadata (`label`, `tone`, `order`) declared per select field and consumed by the front via the schema contract, with a neutral fallback.

## Requirements

### Requirement: Per-Field State Metadata

A select field MAY declare `states: { VALUE: { label, tone, order } }`. Metadata MUST be optional; fields without `states` behave exactly as today.

#### Scenario: Field with states metadata validates

- GIVEN a resource declares `states` with valid enum members as keys
- WHEN the registry validator runs
- THEN validation passes

#### Scenario: Field without states metadata is unaffected

- GIVEN a resource whose select field has no `states` key
- WHEN the resource is loaded
- THEN no validation error occurs and behavior is unchanged

### Requirement: Contract Projection of New Schema Keys

The contract checker (`api:check`) MUST project `transitions`, `history`, and `states` from the back schema to the front schema and MUST fail when the front schema drifts from the projection.

#### Scenario: Projection keeps schemas in sync

- GIVEN `orders.js` declares `transitions`, `history`, and `states`
- WHEN `api:check` runs
- THEN the projected front schema contains the same `transitions`, `history`, and `states` data and the check passes

#### Scenario: Front drift fails the contract check

- GIVEN the front schema omits or corrupts one of the projected keys
- WHEN `api:check` runs
- THEN the check fails naming the drifted key

### Requirement: Badge Tone From Schema With Fallback

Display badges MUST render `tone` from schema `states` metadata when present, and MUST fall back to the existing `resolveBadgeKind` mapping when metadata is absent. Unmanaged resources MUST render identically to today.

#### Scenario: Schema tone wins when present

- GIVEN `orders.status` metadata declares a tone for `"ENTREGADO"`
- WHEN the badge renders a row with `status = "ENTREGADO"`
- THEN the badge uses the schema-declared tone and label

#### Scenario: Neutral fallback when states absent

- GIVEN a field with no `states` metadata (e.g. a legacy resource)
- WHEN its badge renders
- THEN the tone/label come from the existing hardcoded mapping, unchanged from current behavior
