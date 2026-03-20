---
gsd_state_version: 1.0
milestone: v0.17.0
milestone_name: Copy/Move Test Cases Between Projects
status: planning
stopped_at: —
last_updated: "2026-03-20"
last_activity: 2026-03-20 — Milestone v0.17.0 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Current focus:** v0.17.0 Copy/Move Test Cases Between Projects

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-20 — Milestone v0.17.0 started

Progress: [░░░░░░░░░░] 0% (v0.17.0 phases)

## Performance Metrics

**Velocity:**
- Total plans completed (v0.17.0): 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

## Accumulated Context
| Phase 25-default-template-schema P01 | 5min | 2 tasks | 5 files |
| Phase 26-admin-assignment-ui P01 | 5 | 1 tasks | 1 files |
| Phase 26 P02 | 15min | 2 tasks | 3 files |
| Phase 26-admin-assignment-ui P02 | 45min | 3 tasks | 4 files |
| Phase 27-export-dialog-filtering P01 | 15min | 2 tasks | 2 files |

### Decisions

- Follow TemplateProjectAssignment pattern (existing pattern for case field template assignments)
- Backward compatible fallback: no assignments = show all enabled templates
- SCHEMA-01 already complete (CaseExportTemplateProjectAssignment join model exists in schema.zmodel)
- ZenStack hooks for CaseExportTemplateProjectAssignment are already generated
- [Phase 25-default-template-schema]: Used onDelete: SetNull on defaultCaseExportTemplateId FK so deleting a CaseExportTemplate clears the default on referencing projects
- [Phase 25-default-template-schema]: Named relation 'ProjectDefaultExportTemplate' disambiguates from CaseExportTemplateProjectAssignment join-table relation
- [Phase 26-admin-assignment-ui]: Mirrored Projects model access pattern for project-admin-scoped create/delete on CaseExportTemplateProjectAssignment
- [Phase 26-admin-assignment-ui]: Added translation keys in Task 1 commit because TypeScript validates next-intl keys against en-US.json at compile time
- [Phase 26-admin-assignment-ui]: MultiAsyncCombobox chosen over checkbox list for better UX with large template lists
- [Phase 26-admin-assignment-ui]: selectedTemplates stored as TemplateOption[] objects so badge data available without re-lookup
- [Phase 27-export-dialog-filtering]: Used templateId (not caseExportTemplateId) — join model field name per schema.zmodel
- [Phase 27-export-dialog-filtering]: filteredTemplates pattern: fetch global templates + assignment filter in useMemo for project-scoped template display

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-19T05:35:21.836Z
Stopped at: Completed 27-export-dialog-filtering/27-01-PLAN.md
Resume file: None
