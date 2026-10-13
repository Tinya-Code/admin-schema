# View Composition Specification

## Purpose

Embedded composition: a schema arranges registered `kind:'view'` children (tabs container) in the current page, no route per panel. Covers container contract, composer host, `ViewContext`, validation, state isolation, tab lifecycle (R9.9.2/3/5).

## Requirements

### Requirement: Container contract

A container `uiView` (e.g. `type:'tabs'`) SHALL declare an ordered child list. Each child MUST have a stable `id`, a `label`, a registered `type` (`kind:'view'`), its own typed `config`, optional declarative `visibility`, and MAY declare an `initial` selection.

#### Scenario: Valid heterogeneous container

- GIVEN tabs with `[{id:'cal',type:'calendar'},{id:'board',type:'kanban'},{id:'rows',type:'list'}]`
- WHEN the container validates and renders
- THEN children render in declared order via the registry, each with its own config
- AND the `initial` child is selected on first mount

#### Scenario: Duplicate or missing identity

- GIVEN two children sharing `id:'cal'`, or a child without `id`
- WHEN pre-render validation runs
- THEN it fails naming the container and the offending id

### Requirement: Fail-loud pre-render validation

Every composition SHALL be validated before render: duplicate ids, unknown types, missing targets/params, incompatible sources, cycles/circular refs, and configurable depth/node limits. Violations MUST fail with a readable schema error naming resource, container and node; invalid branches MUST NOT be hidden or silently substituted.

#### Scenario: Cycle in nested composition

- GIVEN a container that (directly or transitively) contains itself
- WHEN validation runs
- THEN it fails before render naming both node ids
- AND no partial UI renders

#### Scenario: Depth over limit

- GIVEN nesting deeper than the configured limit
- WHEN validation runs
- THEN it fails with an error stating node id and observed depth

### Requirement: Composer host

ONE generic recursive composer host SHALL resolve each child ONLY by `(kind:'view', type)` via the render registry and its lazy `load()`, show explicit per-child loading/error states, and tear down cleanly on unmount/switch. It MUST contain no domain `type` `switch` and import no leaf.

#### Scenario: Unknown child type

- GIVEN a child `type:'heatmap'` with no descriptor
- WHEN validation runs
- THEN a readable schema error is produced; no fallback screen renders

#### Scenario: Lazy load failure

- GIVEN a registered child whose `load()` rejects
- WHEN the child mounts
- THEN that region shows an explicit error state, siblings stay mounted, and the failure is kept for diagnostics

### Requirement: ViewContext channel

A typed `ViewContext`, separate from the field-level `RenderContext`, SHALL carry only the serializable data, services and navigation callbacks a child needs, via the channel route-mounted children receive (route-data-equivalent) — NOT `input.required`, because `loadComponent` passes no inputs.

#### Scenario: Child resolves context without inputs

- GIVEN a leaf mounted via `load()`
- WHEN it reads `ViewContext`
- THEN it resolves schema/resource/navigation from that channel with no input bindings
- AND no field `RenderContext` is reused

### Requirement: Per-instance state isolation

Each instance SHALL have a stable identity; selection, filters, date range and loading state MUST key by that identity so same-type siblings never contaminate each other.

#### Scenario: Two same-type instances

- GIVEN tabs with two differently configured `kanban` children
- WHEN the user filters the first
- THEN the second keeps its own filters, date range and loading state

### Requirement: Tab lifecycle policy

On tab change, state SHALL be kept only if declared; otherwise the child MUST be destroyed and its subscriptions and local cache released.

#### Scenario: Undeclared state on switch

- GIVEN tab A active with loaded rows and no retention declared
- WHEN the user switches to tab B
- THEN A is destroyed and its subscriptions/local cache released
- AND switching back remounts A fresh

### Requirement: Backward compatibility

A schema without composition MUST behave as today: base `list`/`detail`/`form`/`dashboard` `uiViews` and their existing routes keep working unchanged.

#### Scenario: Non-composed resource

- GIVEN a resource declaring only base `uiViews`
- WHEN routes build and pages render
- THEN the route set and behavior are identical to before this change
