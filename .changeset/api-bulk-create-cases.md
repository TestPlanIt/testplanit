---
"@testplanit/api": minor
---

Add `client.createTestCases()` — bulk test-case creation in a single request, with per-case steps, tags, and custom fields, optional per-case folder/state, and a per-case success/failure result (so partial failures are visible). Backed by the `/api/projects/{projectId}/cases/bulk-create` endpoint; requires a TestPlanIt instance running app v0.39.0+.
