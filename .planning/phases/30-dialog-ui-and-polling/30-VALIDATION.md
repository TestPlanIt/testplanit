---
phase: 30
slug: dialog-ui-and-polling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test -- --run components/copy-move` |
| **Full suite command** | `pnpm test -- --run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- --run components/copy-move`
- **After every plan wave:** Run `pnpm test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 30-01-01 | 01 | 1 | DLGSEL-01 | unit | `pnpm test -- --run components/copy-move` | ❌ W0 | ⬜ pending |
| 30-01-02 | 01 | 1 | BULK-02 | unit | `pnpm test -- --run components/copy-move` | ❌ W0 | ⬜ pending |
| 30-02-01 | 02 | 2 | DLGSEL-03 | unit | `pnpm test -- --run components/copy-move` | ❌ W0 | ⬜ pending |
| 30-02-02 | 02 | 2 | BULK-04 | unit | `pnpm test -- --run components/copy-move` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `components/copy-move/useCopyMoveJob.test.ts` — polling hook test stubs
- [ ] `components/copy-move/CopyMoveDialog.test.tsx` — dialog component test stubs

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Folder tree renders correctly after project selection | DLGSEL-04 | Requires actual folder data rendering | Select project, verify folder tree loads |
| Progress bar updates smoothly during bulk operation | BULK-02 | Visual smoothness not testable in unit tests | Run bulk operation, observe progress |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
