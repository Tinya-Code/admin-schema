# View Navigation Specification

## Purpose

Navigation/route drill-down: leaf views emit ONE typed selection event, schemas declare targets resolved against known routes, transitions keep guards and history. Read-only by default (R9.9.4/6).

## Requirements

### Requirement: Navigation target contract

A navigation target SHALL declare a resource and a declared `uiView`, resolve against a known route pattern, and name allowed params plus the record key. Arbitrary user URLs MUST NOT be accepted, and route segments MUST NOT be built by unencoded string concatenation — navigation goes through the route builder/router with encoded params.

#### Scenario: Valid drill-down target

- GIVEN target `{resource:'orders', view:'detail', params:['key']}` and selected key `A/B`
- WHEN selection fires
- THEN the router navigates with encoded segments to the declared detail route
- AND `roleGuard` runs

#### Scenario: Arbitrary URL rejected

- GIVEN a target declaring a raw/external URL instead of resource+view
- WHEN validation runs
- THEN it fails pre-render with a readable schema error; nothing navigates

### Requirement: Explicit selection event

Leaf views (list, calendar, kanban, …) SHALL emit ONE typed selection event (resource + key + named action) as the only transition trigger. A target MUST declare which event (open, select or named action) activates it; "any click navigates" MUST NOT be the default.

#### Scenario: Selection without declared behavior

- GIVEN a leaf with no declared selection behavior
- WHEN the user clicks a row, card or event
- THEN no navigation occurs; local behavior keeps working

#### Scenario: Named action selects its target

- GIVEN a target activated by named action `open-detail`
- WHEN the leaf emits `open-detail` for a record key
- THEN only that target's declared transition runs

### Requirement: Drill-down contract

Drill-down from list/calendar/kanban SHALL use the shared selection contract, resolve the declared target, preserve guards/authorization and history, and pass only the record key — never the full record object — as identity.

#### Scenario: Guards stay intact

- GIVEN a user without read permission on the target
- WHEN selection fires
- THEN the guard blocks navigation and no record payload reached the router

### Requirement: Read-only default and declared write actions

Composition and selection SHALL be read-only by default. Any create/edit/move action MUST declare its operation explicitly and pass permission checks; hiding a control is not authorization.

#### Scenario: Undeclared mutation fails closed

- GIVEN a move action without a declared operation
- WHEN it is invoked
- THEN it fails without navigating or persisting anything

### Requirement: Target load error recovery

When a navigation target fails to load, the system SHALL keep a way back and communicate the failure; it MUST NOT leave an empty page or a partial destination.

#### Scenario: Detail load fails

- GIVEN navigation to a detail route whose fetch fails
- WHEN the error state renders
- THEN it shows a message plus a working back affordance
- AND the original error is preserved for diagnostics

### Requirement: Per-node states and resource hygiene

Permissions SHALL propagate from resource/session to every node. Each node manages `loading`, `empty`, `error`, `unauthorized` and `not-found` independently, with retry where applicable. The system MUST NOT interpolate untrusted data into paths/selectors/HTML, duplicate subscriptions on mount/unmount, issue N+1 reads per panel, race quick selections against late responses, or contaminate caches across incompatible resource/configs.

#### Scenario: Unauthorized child

- GIVEN a child on a resource the session cannot read
- WHEN it mounts
- THEN it renders `unauthorized` without fetching
- AND sibling nodes load normally

#### Scenario: Rapid selection race

- GIVEN two rapid selections responding out of order
- WHEN responses land
- THEN only the latest selection's result is displayed

### Requirement: Backward compatibility

Schemas without composition SHALL keep list/detail/form/dashboard routes and their existing row navigation unchanged.

#### Scenario: Existing routes untouched

- GIVEN a resource with only base `uiViews`
- WHEN a row triggers its current navigation
- THEN behavior is identical to before this change
