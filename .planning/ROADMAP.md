# Roadmap: LLM Budget Alerts

## Overview

This milestone adds spend threshold alerting to TestPlanIt's existing LLM integration system. Schema changes unlock typed database access, then an isolated alert service handles spend aggregation, threshold comparison, deduplication, and admin notification fan-out through the existing BullMQ pipeline. A UI disclaimer and current-spend display on the settings page complete the admin experience. All three phases build on each other in strict dependency order: schema first, backend service second, UI last.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Schema Foundation** - Add `alertThresholdsFired Json?` field to `LlmProviderConfig` and `LLM_BUDGET_ALERT` enum; run `pnpm generate` to unlock typed access (completed 2026-03-02)
- [ ] **Phase 2: Alert Service and Pipeline** - Build `LlmBudgetAlertService`, wire into `trackUsage()`, update email worker routing
- [ ] **Phase 3: Settings Page UI** - Add budget disclaimer and current-spend display to the LLM integration settings page

## Phase Details

### Phase 1: Schema Foundation
**Goal**: The database has the structures needed to persist and deduplicate budget alert state via `alertThresholdsFired Json?` on `LlmProviderConfig`, and the Prisma/ZenStack client has the `NotificationType.LLM_BUDGET_ALERT` enum value generated
**Depends on**: Nothing (first phase)
**Requirements**: SCHM-01, SCHM-02
**Success Criteria** (what must be TRUE):
  1. `pnpm generate` completes without errors after schema changes are applied
  2. `alertThresholdsFired` field exists on `LlmProviderConfig` and is accessible in TypeScript
  3. `NotificationType.LLM_BUDGET_ALERT` is a valid enum value accessible in TypeScript without casting
**Plans**: 1 plan
- [ ] 01-01-PLAN.md — Add alertThresholdsFired field and LLM_BUDGET_ALERT enum to schema.zmodel, regenerate types

### Phase 2: Alert Service and Pipeline
**Goal**: After every LLM usage is recorded, the system asynchronously checks whether any budget threshold has been crossed and, if so, notifies all ADMIN users exactly once per threshold per calendar month through the existing notification pipeline
**Depends on**: Phase 1
**Requirements**: CHCK-01, CHCK-02, CHCK-03, CHCK-04, ALRT-01, ALRT-02, ALRT-03, ALRT-04, ALRT-05, ALRT-06, ALRT-07
**Success Criteria** (what must be TRUE):
  1. When accumulated spend for a provider crosses 80%, 90%, or 100% of `monthlyBudget`, all ADMIN users receive an in-app notification and (per their preferences) an email
  2. A second LLM call after the same threshold is crossed does not send a duplicate notification for the same provider and billing month
  3. The LLM response path is not slowed by the budget check — the check fires after `trackUsage()` returns, with errors caught and logged but not propagated
  4. Notification text states the provider name, current spend in dollars, budget limit in dollars, and the disclaimer that the budget is informational only
  5. Providers with no `monthlyBudget` set (including zero-cost Ollama providers) do not trigger any budget alert
**Plans**: 3 plans

- [ ] 02-01-PLAN.md — BudgetAlertService TDD: pure business logic for threshold checking, deduplication, and admin notification fan-out
- [ ] 02-02-PLAN.md — Queue infrastructure, worker, i18n, and deployment: register budget-alerts queue, create budgetAlertWorker, add i18n keys, update package.json and PM2 config
- [ ] 02-03-PLAN.md — Wire pipeline: add fire-and-forget enqueue to trackUsage/trackStreamUsage, reset alertThresholdsFired on budget save

### Phase 3: Settings Page UI
**Goal**: Admins visiting the LLM integration settings page see a disclaimer that the budget is informational and cannot prevent overage, and they can see the current month's spend against their configured budget
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. The LLM budget settings page displays a visible disclaimer explaining that setting a monthly budget does not block LLM usage
  2. The settings page shows the current calendar month's total spend for the provider (e.g., "$142.50 of $150.00")
  3. A visual progress bar reflects the ratio of current spend to configured budget, including states for over-budget
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema Foundation | 1/1 | Complete    | 2026-03-02 |
| 2. Alert Service and Pipeline | 1/3 | In Progress | - |
| 3. Settings Page UI | 0/TBD | Not started | - |
