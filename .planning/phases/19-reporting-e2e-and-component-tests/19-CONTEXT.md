# Phase 19: Reporting E2E and Component Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

E2E and component tests for reporting and analytics. Covers: report builder, pre-built reports, drill-down, share links, forecasting, chart components, share link components. 5 existing share link specs + 1 report stats spec. RPT-04 (share links) likely already covered.

</domain>

<decisions>
## Implementation Decisions

### Coverage Strategy
- Gap-fill: 5 share link E2E specs already exist — verify RPT-04 coverage
- 1 existing report spec (repository-stats-test-case-dimension.spec.ts)
- New specs needed: report builder, pre-built report types, drill-down, forecasting
- Component tests: ReportBuilder, ReportChart, DrillDownDrawer, chart visualizations, share components

### Claude's Discretion
- Exact report types to test (automation trends, flaky tests, etc.)
- Which chart components to prioritize for testing
- Forecasting test approach (may need seeded data)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- 5 share link E2E specs for patterns
- components/reports/ReportBuilder.test.tsx — existing component test
- components/dataVisualizations/*.test.tsx — some existing chart tests

### Integration Points
- Report pages: app/[locale]/projects/reports/[projectId]/
- Share pages: app/[locale]/share/[shareKey]/
- Report API: /api/report-builder, /api/report-builder/*
- Forecast API: /api/repository-cases/forecast, /api/milestones/[id]/forecast

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

*Phase: 19-reporting-e2e-and-component-tests*
*Context gathered: 2026-03-19*
