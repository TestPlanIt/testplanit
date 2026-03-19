# Phase 24: Hooks, Notifications, and Workers - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Unit tests for custom hooks, notification components/API, and background workers. Covers: ZenStack data fetching hooks, permission hooks, UI state hooks, form hooks, integration hooks, NotificationBell/Content/Preferences components, notification dispatch API, emailWorker, repoCacheWorker, autoTagWorker.

</domain>

<decisions>
## Implementation Decisions

### Hook Test Strategy
- ZenStack auto-generated hooks: lightweight shape verification (don't test the framework)
- Permission hooks: test all permission states with mock data
- UI state hooks: test data transformation and state management
- Form/integration hooks: test with renderHook from @testing-library/react
- Existing: useExportData.test.tsx, useProjectPermissions.test.tsx, useReportColumns.test.tsx, useRepositoryCasesWithFilteredFields.test.ts

### Notification Tests
- Existing: NotificationBell.test.tsx (2 files), NotificationContent.test.tsx, NotificationPreferences.test.tsx
- Gap-fill: verify existing tests still pass, add missing states
- API dispatch: test notification service calls

### Worker Tests
- Existing: auditLogWorker, elasticsearchReindexWorker, forecastWorker, milestoneJobs, notificationWorker, syncWorker, testmoImportWorker
- Gap-fill: emailWorker, repoCacheWorker, autoTagWorker

### Claude's Discretion
- Which ZenStack hooks to test (pick representative samples)
- Mock depth for worker tests
- Test organization

</decisions>

<code_context>
## Existing Tests
- hooks/useExportData.test.tsx, useProjectPermissions.test.tsx, useReportColumns.test.tsx, useRepositoryCasesWithFilteredFields.test.ts
- components/NotificationBell.test.tsx, NotificationBell.openNotifications.test.tsx, NotificationContent.test.tsx
- app/[locale]/users/profile/[userId]/NotificationPreferences.test.tsx
- workers/*.test.ts (7 existing worker tests)

### Integration Points
- hooks: lib/hooks/ (93+ files, auto-generated)
- notifications: components/NotificationBell, NotificationContent
- workers: workers/*.ts

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>

---

*Phase: 24-hooks-notifications-and-workers*
*Context gathered: 2026-03-19*
