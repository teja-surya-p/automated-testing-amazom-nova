UI/UX audit type implementation (checks, runner, retention, and reporting helpers).
This module runs only when testMode is `uiux`.

Checklist source-of-truth and status:
- Runtime detectors are defined in `/Users/surya/Desktop/hackathons/automated-testing-amazom-nova/backend/src/types/uiux/checks/index.js`.
- Canonical checklist taxonomy (implemented + planned expansion items) is defined in `/Users/surya/Desktop/hackathons/automated-testing-amazom-nova/backend/src/types/uiux/handbook/taxonomy.js` and shared with dashboard launch Step-2 via `/Users/surya/Desktop/hackathons/automated-testing-amazom-nova/shared/uiuxChecklistCatalog.js`.
- `implementationStatus: "implemented"` means the check has a runtime detector today.
- `implementationStatus: "planned"` means it is cataloged for checklist coverage and UI selection visibility but is not executed by the runtime detectors yet.

Category groups are aligned to the checklist expansion document:
1. Layout, spacing, and structure
2. Responsive and mobile-specific behavior
3. Navigation clarity and wayfinding
4. Buttons, controls, and interaction affordance
5. Form UX and data entry
6. Search, filter, sort, and dense data
7. Tables, charts, and data visualization
8. States, system feedback, and recovery
9. Content clarity, hierarchy, and readability
10. Modals, drawers, sheets, and overlays
11. Commerce and critical conversion flows
12. Accessibility-adjacent UX checks
