---
gsd_state_version: 1.0
milestone: v0.17.0
milestone_name: Per-Prompt LLM Configuration
status: planning
last_updated: "2026-03-21"
last_activity: "2026-03-21 — Milestone v0.17.0 Per-Prompt LLM Configuration started"
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Current focus:** v0.17.0 Per-Prompt LLM Configuration

## Current Position

Phase: 34 of 39 (Schema and Migration)
Plan: Not started
Status: Roadmap complete — ready for Phase 34
Last activity: 2026-03-21 — Milestone v0.17.0 roadmap created (6 phases, 19 requirements)

## Accumulated Context

### Decisions

(Carried from previous milestone)

- Worker uses raw `prisma` (not `enhance()`); ZenStack access control gated once at API entry only
- Unique constraint errors detected via string-matching err.info?.message for "duplicate key" (not err.code === "P2002")

### Pending Todos

None yet.

### Blockers/Concerns

None yet.
