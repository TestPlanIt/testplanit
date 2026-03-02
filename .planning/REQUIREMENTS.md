# Requirements: LLM Budget Alerts

**Defined:** 2026-03-01
**Core Value:** Admins are never surprised by LLM costs — they get timely alerts at predictable thresholds so they can decide how to respond.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Schema

- [x] **SCHM-01**: `LlmProviderConfig` has an `alertThresholdsFired Json?` field to track which thresholds have fired per billing month (e.g., `{"2026-03": [80, 90]}`)
- [x] **SCHM-02**: `NotificationType` enum includes `LLM_BUDGET_ALERT` value

### Budget Checking

- [ ] **CHCK-01**: After each LLM usage is recorded, system asynchronously checks current month's total spend against the provider's `monthlyBudget`
- [x] **CHCK-02**: System calculates current month spend by aggregating `LlmUsage.totalCost` for the provider within the calendar month
- [x] **CHCK-03**: Budget check does not add latency to the LLM response path (fire-and-forget or queued)
- [x] **CHCK-04**: Decimal values from Prisma are converted to numbers before threshold comparison (not string comparison)

### Alerting

- [x] **ALRT-01**: System alerts all ADMIN users when spend crosses 80% of monthly budget
- [x] **ALRT-02**: System alerts all ADMIN users when spend crosses 90% of monthly budget
- [x] **ALRT-03**: System alerts all ADMIN users when spend crosses 100% of monthly budget
- [x] **ALRT-04**: Each threshold fires exactly once per billing cycle per provider (enforced by checking `alertThresholdsFired` JSON field before sending)
- [x] **ALRT-05**: Alert notification text includes dollar amounts: current spend and budget limit (e.g., "$142.50 of $150.00")
- [x] **ALRT-06**: Alerts delivered through existing notification preferences (in-app, email per user settings)
- [x] **ALRT-07**: Alert notification text includes budget disclaimer: setting a budget does not prevent exceeding it — it's informational only for admin decision-making

### UI

- [ ] **UI-01**: LLM budget settings page displays disclaimer text explaining budget is informational only and does not block usage
- [ ] **UI-02**: LLM budget settings page shows current month's spend for the provider
- [ ] **UI-03**: LLM budget settings page shows visual progress bar of spend vs budget

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Alerting Enhancements

- **ALRT-08**: Admin can view alert history (past budget alerts) in admin panel
- **ALRT-09**: Admin can configure custom threshold percentages instead of fixed 80/90/100%
- **ALRT-10**: Per-project budget alerts (separate from provider-level)

### UI Enhancements

- **UI-04**: Historical spend trend chart on settings page
- **UI-05**: Spend forecast based on current usage rate

## Out of Scope

| Feature | Reason |
|---------|--------|
| Hard blocking of LLM features at budget | Admins decide what action to take — system is informational only |
| Per-project budgets | Provider-level budgets are sufficient for v1; per-project adds schema complexity |
| Custom threshold percentages | Fixed 80/90/100% covers the common case; no evidence custom thresholds improve outcomes |
| Real-time spend streaming | Polling or page refresh is sufficient for settings page spend display |
| Automatic model switching on budget exceed | Too opinionated — admins should choose their response |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHM-01 | Phase 1 | Complete |
| SCHM-02 | Phase 1 | Complete |
| CHCK-01 | Phase 2 | Pending |
| CHCK-02 | Phase 2 | Complete |
| CHCK-03 | Phase 2 | Complete |
| CHCK-04 | Phase 2 | Complete |
| ALRT-01 | Phase 2 | Complete |
| ALRT-02 | Phase 2 | Complete |
| ALRT-03 | Phase 2 | Complete |
| ALRT-04 | Phase 2 | Complete |
| ALRT-05 | Phase 2 | Complete |
| ALRT-06 | Phase 2 | Complete |
| ALRT-07 | Phase 2 | Complete |
| UI-01 | Phase 3 | Pending |
| UI-02 | Phase 3 | Pending |
| UI-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-01*
*Last updated: 2026-03-01 after roadmap creation*
