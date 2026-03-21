# Requirements: Copy/Move Test Cases Between Projects

**Defined:** 2026-03-20
**Core Value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Issue:** GitHub #79

## v0.17.0 Requirements

Requirements for cross-project test case copy/move. Each maps to roadmap phases.

### Dialog & Selection

- [x] **DLGSEL-01**: User can select one or more test cases and choose "Copy/Move to Project" from context menu
- [x] **DLGSEL-02**: User can select "Copy/Move to Project" from bulk actions toolbar
- [ ] **DLGSEL-03**: User can pick a target project from a list filtered to projects they have write access to
- [ ] **DLGSEL-04**: User can pick a target folder in the destination project via folder picker
- [ ] **DLGSEL-05**: User can choose between Move (removes from source) or Copy (leaves source unchanged) operation
- [ ] **DLGSEL-06**: User sees a pre-flight collision check and can resolve naming conflicts before any writes begin

### Data Carry-Over

- [x] **DATA-01**: Copied/moved cases carry over all steps to the target project
- [x] **DATA-02**: Copied/moved cases carry over custom field values to the target project
- [x] **DATA-03**: Copied/moved cases carry over tags to the target project
- [x] **DATA-04**: Copied/moved cases carry over issue links to the target project
- [x] **DATA-05**: Copied/moved cases carry over attachments by URL reference (no re-upload)
- [x] **DATA-06**: Moved cases preserve their full version history in the target project
- [x] **DATA-07**: Copied cases start at version 1 with fresh version history
- [x] **DATA-08**: Shared step groups are recreated in the target project so steps remain shared
- [x] **DATA-09**: User is prompted when a shared step group name already exists in the target — reuse existing or create new

### Compatibility

- [x] **COMPAT-01**: User sees a warning if source and target projects use different templates
- [x] **COMPAT-02**: Admin/Project Admin users can auto-assign missing templates to the target project (enabled by default)
- [x] **COMPAT-03**: If a test case uses a workflow state not in the target project, user can associate missing states with the target
- [x] **COMPAT-04**: Non-admin users see a warning that cases with unmatched workflow states will use the target project's default state

### Bulk Operations

- [x] **BULK-01**: Bulk copy/move of 100+ cases is processed asynchronously via BullMQ with progress polling
- [x] **BULK-02**: User sees a progress indicator during bulk operations
- [x] **BULK-03**: User can cancel an in-flight bulk operation
- [x] **BULK-04**: Per-case errors are reported to the user after operation completes

### Entry Points

- [x] **ENTRY-01**: Copy/Move to Project button appears between Create Test Run and Export in the repository toolbar
- [x] **ENTRY-02**: Copy/Move to Project option appears in the test case context menu (right-click)
- [x] **ENTRY-03**: Copy/Move to Project appears as an action in the bulk edit modal footer

### Documentation

- [x] **DOCS-01**: User-facing documentation covers copy/move workflow, template/workflow handling, and conflict resolution

### Testing

- [x] **TEST-01**: E2E tests verify copy and move operations end-to-end including data carry-over
- [x] **TEST-02**: E2E tests verify template compatibility warnings and workflow state mapping
- [x] **TEST-03**: Unit tests verify the copy/move worker logic including error handling and partial failure recovery
- [x] **TEST-04**: Unit tests verify shared step group recreation and collision handling

### Folder Tree

- [ ] **TREE-01**: User can right-click a folder and choose Copy/Move to copy/move the entire folder tree with all contained cases
- [x] **TREE-02**: Folder hierarchy is recreated in the target project preserving parent-child structure
- [x] **TREE-03**: All cases within the folder tree are processed with the same compatibility handling (templates, workflows, collisions)
- [x] **TREE-04**: User can choose to merge into an existing folder or create the tree fresh in the target

## Future Requirements

None — this is a self-contained feature per issue #79.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Shared/cross-project test case library | Fundamentally different architecture, out of scope per issue #79 |
| Per-user template preferences | Not in issue #79 |
| Cross-project linked case references | Cases linked to cases not in target are dropped |
| Drag-and-drop cross-project move from TreeView | UX enhancement for v0.17.x |
| Per-case rename on conflict | Batch strategy (skip/rename/overwrite) is sufficient for v0.17.0 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status  |
|-------------|-------|---------|
| DLGSEL-01   | 31    | Complete |
| DLGSEL-02   | 31    | Complete |
| DLGSEL-03   | 30    | Pending |
| DLGSEL-04   | 30    | Pending |
| DLGSEL-05   | 30    | Pending |
| DLGSEL-06   | 30    | Pending |
| DATA-01     | 28    | Complete |
| DATA-02     | 28    | Complete |
| DATA-03     | 28    | Complete |
| DATA-04     | 28    | Complete |
| DATA-05     | 28    | Complete |
| DATA-06     | 28    | Complete |
| DATA-07     | 28    | Complete |
| DATA-08     | 28    | Complete |
| DATA-09     | 28    | Complete |
| COMPAT-01   | 29    | Complete |
| COMPAT-02   | 29    | Complete |
| COMPAT-03   | 29    | Complete |
| COMPAT-04   | 29    | Complete |
| BULK-01     | 29    | Complete |
| BULK-02     | 30    | Complete |
| BULK-03     | 29    | Complete |
| BULK-04     | 30    | Complete |
| ENTRY-01    | 31    | Complete |
| ENTRY-02    | 31    | Complete |
| ENTRY-03    | 31    | Complete |
| DOCS-01     | 32    | Complete |
| TEST-01     | 32    | Complete |
| TEST-02     | 32    | Complete |
| TEST-03     | 32    | Complete |
| TEST-04     | 32    | Complete |
| TREE-01     | 33    | Pending |
| TREE-02     | 33    | Complete |
| TREE-03     | 33    | Complete |
| TREE-04     | 33    | Complete |

**Coverage:**

- v0.17.0 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---

*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after adding Phase 33 (Folder Tree Copy/Move)*
