---
phase: 29
slug: api-endpoints-and-access-control
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test -- --run app/api/repository/copy-move` |
| **Full suite command** | `pnpm test -- --run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- --run app/api/repository/copy-move`
- **After every plan wave:** Run `pnpm test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 1 | COMPAT-01 | unit | `pnpm test -- --run app/api/repository/copy-move` | ❌ W0 | ⬜ pending |
| 29-01-02 | 01 | 1 | COMPAT-02 | unit | `pnpm test -- --run app/api/repository/copy-move` | ❌ W0 | ⬜ pending |
| 29-01-03 | 01 | 1 | COMPAT-03 | unit | `pnpm test -- --run app/api/repository/copy-move` | ❌ W0 | ⬜ pending |
| 29-01-04 | 01 | 1 | COMPAT-04 | unit | `pnpm test -- --run app/api/repository/copy-move` | ❌ W0 | ⬜ pending |
| 29-01-05 | 01 | 1 | BULK-01 | unit | `pnpm test -- --run app/api/repository/copy-move` | ❌ W0 | ⬜ pending |
| 29-01-06 | 01 | 1 | BULK-03 | unit | `pnpm test -- --run app/api/repository/copy-move` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] API route test files for copy-move endpoints
- [ ] Test fixtures for mock session, mock projects with template/workflow assignments

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
