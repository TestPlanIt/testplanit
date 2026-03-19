# Requirements: Per-Project Export Template Assignment

**Defined:** 2026-03-18
**Core Value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Issue:** GitHub #85

## v2.1 Requirements

Requirements for per-project export template assignment. Each maps to roadmap phases.

### Schema

- [x] **SCHEMA-01**: CaseExportTemplateProjectAssignment join model links CaseExportTemplate to Project (already exists)
- [x] **SCHEMA-02**: Project has a default case export template relation

### Admin UI

- [ ] **ADMIN-01**: Admin can assign/unassign export templates to a project in project settings
- [ ] **ADMIN-02**: Admin can set a default export template for a project

### Export Dialog

- [ ] **EXPORT-01**: Export dialog only shows templates assigned to the current project
- [ ] **EXPORT-02**: Project default template is pre-selected in the export dialog
- [ ] **EXPORT-03**: If no templates are assigned to a project, all enabled templates are shown (backward compatible)

## Future Requirements

None — this is a self-contained feature.

## Out of Scope

| Feature                               | Reason                                                          |
|---------------------------------------|-----------------------------------------------------------------|
| Per-user template preferences         | Not in issue #85, could be future enhancement                   |
| Template creation from project settings | Templates are managed globally in admin; projects only assign existing ones |
| Template ordering per project         | Unnecessary complexity for v2.1                                 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase    | Status           |
|-------------|----------|------------------|
| SCHEMA-01   | —        | Complete (exists) |
| SCHEMA-02   | Phase 25 | Complete |
| ADMIN-01    | Phase 26 | Pending          |
| ADMIN-02    | Phase 26 | Pending          |
| EXPORT-01   | Phase 27 | Pending          |
| EXPORT-02   | Phase 27 | Pending          |
| EXPORT-03   | Phase 27 | Pending          |

**Coverage:**

- v2.1 requirements: 7 total
- Already complete: 1 (SCHEMA-01)
- Remaining: 6
- Mapped: 6/6

---

*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after roadmap creation (Phases 25-27)*
