# Type Map

## Overview
The server code is organized into:
- `foundation` + 9 testing types under `backend/src/types/`
- one shared cross-type library under `backend/src/library/`

Types:
- `foundation`
- `uiux`
- `functional`
- `accessibility`
- `performance`
- `security`
- `api`
- `dataReliability`
- `compatIntl`
- `compliance`

## Type-by-Type Map

### `foundation`
- Purpose: shared test foundations (schemas/policies/frontier contracts) and core QA runtime conventions.
- Entrypoint files: `backend/src/types/foundation/index.js`
- Checks live in: shared `backend/src/library/` modules
- Tests live in: `backend/src/types/foundation/tests/`

### `uiux`
- Purpose: objective UI/UX checks, coverage runner, issue clustering, repro/baseline support.
- Entrypoint files: `backend/src/types/uiux/index.js`, `backend/src/types/uiux/uiuxRunner.js`
- Checks live in: `backend/src/types/uiux/checks/`
- Tests live in: `backend/src/types/uiux/tests/`

### `functional`
- Purpose: deterministic functional flows, assertion DSL, blockers, submit gating, baselines.
- Entrypoint files: `backend/src/types/functional/index.js`, `backend/src/types/functional/functionalRunner.js`
- Checks/assertions live in: `backend/src/types/functional/assertions/`
- Tests live in: `backend/src/types/functional/tests/`

### `accessibility`
- Purpose: deterministic accessibility rules/runners with a11y clustering and baselines.
- Entrypoint files: `backend/src/types/accessibility/index.js`, `backend/src/types/accessibility/a11yRunner.js`
- Checks/rules live in: `backend/src/types/accessibility/rules/`
- Tests live in: `backend/src/types/accessibility/tests/`

### `performance`
- Purpose: placeholder for objective performance checks.
- Entrypoint files: `backend/src/types/performance/index.js`
- Checks live in: `backend/src/types/performance/` (to be added)
- Tests live in: `backend/src/types/performance/tests/` (to be added)

### `security`
- Purpose: placeholder for safe non-destructive security checks.
- Entrypoint files: `backend/src/types/security/index.js`
- Checks live in: `backend/src/types/security/` (to be added)
- Tests live in: `backend/src/types/security/tests/` (to be added)

### `api`
- Purpose: placeholder for browser-observed API contract/reliability checks.
- Entrypoint files: `backend/src/types/api/index.js`
- Checks live in: `backend/src/types/api/` (to be added)
- Tests live in: `backend/src/types/api/tests/` (to be added)

### `dataReliability`
- Purpose: placeholder for data consistency/reliability checks.
- Entrypoint files: `backend/src/types/dataReliability/index.js`
- Checks live in: `backend/src/types/dataReliability/` (to be added)
- Tests live in: `backend/src/types/dataReliability/tests/` (to be added)

### `compatIntl`
- Purpose: placeholder for compatibility + internationalization checks.
- Entrypoint files: `backend/src/types/compatIntl/index.js`
- Checks live in: `backend/src/types/compatIntl/` (to be added)
- Tests live in: `backend/src/types/compatIntl/tests/` (to be added)

### `compliance`
- Purpose: placeholder for policy/compliance validations.
- Entrypoint files: `backend/src/types/compliance/index.js`
- Checks live in: `backend/src/types/compliance/` (to be added)
- Tests live in: `backend/src/types/compliance/tests/` (to be added)

## Shared Library: What Belongs Where

Use `backend/src/library/` for logic reused by multiple types or by core runtime:
- `schemas/`: run config + action contracts
- `policies/`: safety and shared UI control classifier
- `url/`: canonicalization/frontier primitives
- `reporting/`: shared clustering utilities
- `metrics/`: shared similarity/stat helpers

Put logic in `types/<type>/` when it is type-specific and not reused cross-type.

Keep runtime plumbing in existing core locations (for now):
- `backend/src/orchestrator/`
- `backend/src/services/`
- `backend/src/routes/`
- `backend/src/providers/`

## Naming Conventions

### Rule IDs
- UPPER_SNAKE_CASE, deterministic, objective.
- Examples: `BROKEN_IMAGE`, `MISSING_FORM_LABEL`, `NO_API_5XX`.

### Issue schema fields
Use a consistent issue object shape:
- `issueType` or `ruleId`
- `severity` (`P0`/`P1`/`P2`/`P3`)
- `title`
- `expected`
- `actual`
- `confidence` (0-1)
- `evidenceRefs` (array)
- `affectedSelector` (optional)
- `affectedUrl` (optional)
- `step` (optional)
- `viewportLabel` (optional)

Calibrated fields (when applicable):
- `finalSeverity`
- `finalConfidence`

### Baseline IDs
- Lowercase slug with `[a-z0-9_-]`
- Max length: 120
- Examples: `uiux-release-2026q1`, `functional-local`, `a11y-main`

### Cluster keys
- UI/UX cluster key: `issueType|normalizedPath|viewportLabel|affectedSelector`
- Accessibility cluster key: `ruleId|normalizedPath`
- Keep keys deterministic and based on normalized URL path (no query/hash noise).

## How to Add a New Rule + Test

1. Pick the target type folder, for example `backend/src/types/uiux/`.
2. Add the rule implementation:
   - UI/UX: `backend/src/types/uiux/checks/index.js`
   - Accessibility: `backend/src/types/accessibility/rules/index.js`
   - Functional assertion: `backend/src/types/functional/assertions/coreRules.js`
3. Register it in the type registry:
   - UI/UX: `backend/src/types/uiux/checks/registry.js`
   - Accessibility: `backend/src/types/accessibility/rules/registry.js`
4. Return deterministic issue objects using the schema fields above.
5. Add unit tests in that type’s tests folder, e.g.:
   - `backend/src/types/uiux/tests/<rule>.test.js`
6. Keep tests pure with mocked snapshots/inputs where possible (non-Playwright logic first).
7. Run verification:
   - `npm test --workspace @qa/server`
   - `npm run build --workspace @qa/dashboard`
