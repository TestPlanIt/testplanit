# TestPlanIt - ZenStack Upgrade Regression Tests

## What This Is

API-level regression test suite for TestPlanIt that exercises the ZenStack data layer through the REST API (`/api/model/`). Designed to be run before and after the ZenStack v2→v3 upgrade to verify that all core application workflows continue to function correctly.

## Core Value

Confidence that the ZenStack v2→v3 upgrade does not break any existing frontend-backend communication — CRUD operations, access control, relation queries, and error handling all behave the same way.

## Current Milestone: v1.1 ZenStack Upgrade Regression Tests

**Goal:** Comprehensive API-level test suite covering all critical data operations so the ZenStack v3 upgrade can be validated.

**Target features:**
- CRUD regression tests for core models (Projects, Cases, TestRuns, etc.)
- Access control tests across user contexts (admin, project user, no-access)
- Relation/nested include tests for complex queries
- Error response format tests (unique constraints, foreign keys, validation)
- Batch operation tests (createMany, updateMany, deleteMany)

## Requirements

### Validated

- ✓ AI bulk tagging for test cases, test runs, and sessions — v1.0
- ✓ Smart batching to balance cost and accuracy — v1.0
- ✓ Review dialog before applying suggested tags — v1.0
- ✓ New tag creation when AI suggests tags that don't exist — v1.0
- ✓ Entry points: bulk actions on list views + tags management page — v1.0

### Active

- [ ] API regression tests for ZenStack v3 upgrade validation

### Out of Scope

- Testing ZenStack internals — we test app behavior, not the ORM
- UI-level E2E tests — using Playwright API tests for speed
- Performance/load testing — functional correctness only
- Testing custom API routes that don't use ZenStack (auth, integrations, reports)

## Context

- ZenStack v2→v3 upgrade planned
- Known v3 issues: PostgreSQL 63-char alias limit with deep nesting, error format changes, orderBy bugs
- 98 models with auto-generated hooks, 139 custom API routes
- Existing E2E suite (51 specs) covers UI workflows but not API correctness
- Tests should use Playwright API testing (existing infrastructure)

## Constraints

- **Playwright API tests**: Use existing E2E fixtures and api.fixture.ts helper
- **All user contexts**: Tests must cover admin, regular user, and no-access scenarios
- **Speed**: API-only tests, no browser UI interactions
- **Idempotent**: Tests create and clean up their own data

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Playwright API tests over Vitest | Reuses existing infra, tests against real running app | — Pending |
| Focus on core models | 98 models total, ~15 are critical for user workflows | — Pending |
| Test all access contexts | Access control is the highest-risk area for ORM changes | — Pending |

---
*Last updated: 2026-03-16 after milestone v1.1 initialization*
