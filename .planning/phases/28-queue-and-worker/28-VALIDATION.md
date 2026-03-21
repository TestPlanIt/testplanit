---
phase: 28
slug: queue-and-worker
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test -- --run workers/copyMoveWorker.test.ts` |
| **Full suite command** | `pnpm test -- --run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- --run workers/copyMoveWorker.test.ts`
- **After every plan wave:** Run `pnpm test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 28-01-01 | 01 | 1 | DATA-01 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-02 | 01 | 1 | DATA-02 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-03 | 01 | 1 | DATA-03 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-04 | 01 | 1 | DATA-04 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |
| 28-01-05 | 01 | 1 | DATA-05 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-01 | 02 | 1 | DATA-06 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-02 | 02 | 1 | DATA-07 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |
| 28-03-01 | 03 | 1 | DATA-08 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |
| 28-03-02 | 03 | 1 | DATA-09 | unit | `pnpm test -- --run workers/copyMoveWorker.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `workers/copyMoveWorker.test.ts` — test stubs for all DATA requirements
- [ ] Test fixtures for mock Prisma client, mock job data, mock case records

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Elasticsearch sync fires after batch | DATA-01 | Requires running ES instance | Verify via ES API after worker run |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
