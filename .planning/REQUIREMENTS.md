# Requirements: Copy/Move Test Cases Between Projects

**Defined:** 2026-03-20
**Core Value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Issue:** GitHub #79

## v0.17.0 Requirements

Requirements for cross-project test case copy/move. Each maps to roadmap phases.

### Dialog & Selection

- [ ] **DLGSEL-01**: User can select one or more test cases and choose "Copy/Move to Project" from context menu
- [ ] **DLGSEL-02**: User can select "Copy/Move to Project" from bulk actions toolbar
- [ ] **DLGSEL-03**: User can pick a target project from a list filtered to projects they have write access to
- [ ] **DLGSEL-04**: User can pick a target folder in the destination project via folder picker
- [ ] **DLGSEL-05**: User can choose between Move (removes from source) or Copy (leaves source unchanged) operation
- [ ] **DLGSEL-06**: User sees a pre-flight collision check and can resolve naming conflicts before any writes begin

### Data Carry-Over

- [ ] **DATA-01**: Copied/moved cases carry over all steps to the target project
- [ ] **DATA-02**: Copied/moved cases carry over custom field values to the target project
- [ ] **DATA-03**: Copied/moved cases carry over tags to the target project
- [ ] **DATA-04**: Copied/moved cases carry over issue links to the target project
- [ ] **DATA-05**: Copied/moved cases carry over attachments by URL reference (no re-upload)
- [ ] **DATA-06**: Moved cases preserve their full version history in the target project
- [ ] **DATA-07**: Copied cases start at version 1 with fresh version history
- [ ] **DATA-08**: Shared step groups are recreated in the target project so steps remain shared
- [ ] **DATA-09**: User is prompted when a shared step group name already exists in the target — reuse existing or create new

### Compatibility

- [ ] **COMPAT-01**: User sees a warning if source and target projects use different templates
- [ ] **COMPAT-02**: Admin/Project Admin users can auto-assign missing templates to the target project (enabled by default)
- [ ] **COMPAT-03**: If a test case uses a workflow state not in the target project, user can associate missing states with the target
- [ ] **COMPAT-04**: Non-admin users see a warning that cases with unmatched workflow states will use the target project's default state

### Bulk Operations

- [ ] **BULK-01**: Bulk copy/move of 100+ cases is processed asynchronously via BullMQ with progress polling
- [ ] **BULK-02**: User sees a progress indicator during bulk operations
- [ ] **BULK-03**: User can cancel an in-flight bulk operation
- [ ] **BULK-04**: Per-case errors are reported to the user after operation completes

### Entry Points

- [ ] **ENTRY-01**: Copy/Move to Project button appears between Create Test Run and Export in the repository toolbar
- [ ] **ENTRY-02**: Copy/Move to Project option appears in the test case context menu (right-click)
- [ ] **ENTRY-03**: Copy/Move to Project appears as an action in the bulk edit modal footer

### Documentation

- [ ] **DOCS-01**: User-facing documentation covers copy/move workflow, template/workflow handling, and conflict resolution

### Testing

- [ ] **TEST-01**: E2E tests verify copy and move operations end-to-end including data carry-over
- [ ] **TEST-02**: E2E tests verify template compatibility warnings and workflow state mapping
- [ ] **TEST-03**: Unit tests verify the copy/move worker logic including error handling and partial failure recovery
- [ ] **TEST-04**: Unit tests verify shared step group recreation and collision handling

## Future Requirements

None — this is a self-contained feature per issue #79.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Shared/cross-project test case library | Fundamentally different architecture, out of scope per issue #79 |
| Per-user template preferences | Not in issue #79 |
| Cross-project linked case references | Cases linked to cases not in target are dropped |
| Drag-and-drop cross-project move from TreeView | UX enhancement for v0.17.x |
| Per-case rename on conflict | Batch strategy (skip/rename/overwrite) is sufficient for v0.17.0 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DLGSEL-01 | — | Pending |
| DLGSEL-02 | — | Pending |
| DLGSEL-03 | — | Pending |
| DLGSEL-04 | — | Pending |
| DLGSEL-05 | — | Pending |
| DLGSEL-06 | — | Pending |
| DATA-01 | — | Pending |
| DATA-02 | — | Pending |
| DATA-03 | — | Pending |
| DATA-04 | — | Pending |
| DATA-05 | — | Pending |
| DATA-06 | — | Pending |
| DATA-07 | — | Pending |
| DATA-08 | — | Pending |
| DATA-09 | — | Pending |
| COMPAT-01 | — | Pending |
| COMPAT-02 | — | Pending |
| COMPAT-03 | — | Pending |
| COMPAT-04 | — | Pending |
| BULK-01 | — | Pending |
| BULK-02 | — | Pending |
| BULK-03 | — | Pending |
| BULK-04 | — | Pending |
| ENTRY-01 | — | Pending |
| ENTRY-02 | — | Pending |
| ENTRY-03 | — | Pending |
| DOCS-01 | — | Pending |
| TEST-01 | — | Pending |
| TEST-02 | — | Pending |
| TEST-03 | — | Pending |
| TEST-04 | — | Pending |

**Coverage:**
- v0.17.0 requirements: 31 total
- Mapped to phases: 0
- Unmapped: 31 ⚠️

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after initial definition*
