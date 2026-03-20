# Feature Research

**Domain:** Cross-project test case copy/move for test management platform
**Researched:** 2026-03-20
**Confidence:** MEDIUM-HIGH (competitor behavior confirmed via multiple sources; implementation details inferred from codebase)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist based on what competitors (TestRail, Zephyr Scale, BrowserStack Test Management) offer. Missing these makes the feature feel incomplete or unusable.

| Feature | Why Expected | Complexity | Notes |
| ------- | ------------ | ---------- | ----- |
| Project picker (write-access filtered) | Users should only see projects they can write to; showing all projects and failing silently is confusing | LOW | ZenStack access policy already constrains project queries; filter by `canAddEdit` on `TestCaseRepository` permission |
| Folder placement selector | Depositing cases into the root with no folder choice creates cleanup work for the user; BrowserStack lets you pick folder or root | LOW | Reuse existing `FolderSelect` component; target project's folders must be loaded dynamically after project pick |
| Operation selector (copy vs. move) | Both operations are needed; copy-only forces manual deletion; move-only loses the original — competitors offer both | LOW | Radio group; UI label clarity matters — "Move" removes from source, "Copy" keeps source intact |
| Full field data carry-over (name, steps, custom fields) | Losing test step data or custom field values on transfer is a blocker; users don't trust the feature if data is lossy | MEDIUM | Existing import route handles this logic — reuse `createTestCaseVersionInTransaction` and `CaseFieldValues` creation |
| Tags carried over | Tags are global (no projectId) — reconnecting them cross-project is trivially possible and expected | LOW | Tags model has no projectId; use `connect` by name/id, same as existing import |
| Attachments carried over | Attachments are S3/MinIO URLs already stored — no re-upload needed; just create new `Attachments` records pointing to same URLs | LOW | New `Attachments` row per case, same URL, new `repositoryCaseId` — no storage cost |
| Linked issues carried over | Issue links (Jira, GitHub, ADO) are string references — straightforward to copy | LOW | `Issue` model stores external references; recreate records on target case |
| Conflict detection on duplicate names | `@@unique([projectId, name, className, source])` constraint on `RepositoryCases` means silent failure or DB error without this | MEDIUM | Must pre-check or catch unique constraint error; surface to user before or during processing |
| Progress feedback for bulk operations | 100+ case moves must not appear to hang; existing import uses SSE streaming for progress; users expect the same | MEDIUM | Two viable patterns: SSE (like import route) or BullMQ poll (like auto-tag); see Anti-Features section |
| Success/failure summary | Users need to know how many cases succeeded, failed, and why (name collision, permission error, etc.) | LOW | Collect per-case results and surface in a final toast or results dialog |

### Differentiators (Competitive Advantage)

Features that set TestPlanIt apart from the export/import cycle that Zephyr Scale forces users through.

| Feature | Value Proposition | Complexity | Notes |
| ------- | ----------------- | ---------- | ----- |
| Template compatibility handling | Competitors (Zephyr Scale) require manual recreation of custom fields in the target project before import; TestPlanIt can detect mismatches and guide the user or auto-assign | MEDIUM | Check if target project has a `TemplateProjectAssignment` for a template with matching field definitions; if not, offer to auto-assign the source template (admin only) or warn non-admins |
| Workflow state mapping | Competitors silently drop workflow state or default it; TestPlanIt can map source state to equivalent target state by name, or fall back to the target's default workflow | MEDIUM | Query `ProjectWorkflowAssignment` for target project; match by `Workflows.name`; fall back to `isDefault: true` workflow |
| Move preserves version history | TestRail copies history but moves don't distinguish; TestPlanIt explicitly preserves `repositoryCaseVersions` on move, giving it true relocation semantics | MEDIUM | On move: update `repositoryCases.projectId`, `repositoryId`, `folderId`, `stateId` in-place rather than delete+create — preserves all version records automatically |
| Shared steps carry-over | Shared step groups are project-scoped; few tools handle this gracefully | HIGH | Options: (a) inline shared step content into regular steps in target, (b) create new shared step group in target project. Option (a) is safer for MVP. Flag this for phase research. |
| Bulk selection from existing multi-select UI | Users already have multi-select with checkboxes in the repository view; copy/move plugs into the existing bulk actions toolbar naturally | LOW | Hook into the same `selectedCaseIds` state that drives bulk edit and bulk delete |
| Cancel in-flight bulk operation | Auto-tag worker supports cancellation via Redis flag; copy/move BullMQ job can follow the same pattern | MEDIUM | Only relevant if BullMQ path is chosen over SSE for bulk; adds user confidence for large batches |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
| ------- | ------------- | --------------- | ----------- |
| Silent field value drop on template mismatch | "Just copy what you can" — seems user-friendly | Creates invisible data loss; users discover missing fields after transfer with no audit trail | Surface the mismatch before the operation; let the user decide to proceed (fields will be blank) or abort |
| Cross-project linked case references | "Keep the links intact" | Case IDs differ between projects; maintaining links requires a cross-project reference model (issue #79 explicitly excludes this as a larger architectural change) | Drop `RepositoryCaseLink` entries for cases not in target project; document this behavior in the UI |
| Real-time row-by-row streaming for large bulk ops via SSE | Import route uses SSE streaming inline; seemed natural to reuse | SSE holds an HTTP connection open for the entire duration; for 100+ cases this works, but at 500+ cases it risks timeouts, memory pressure, and proxy buffering issues | Use BullMQ job + polling for bulk ops above a threshold (e.g., >50 cases), matching the auto-tag pattern. SSE is fine for small batches if reused from import route |
| Re-upload attachments to target project storage path | "Attachments belong to the project's S3 prefix" | Storage cost doubles; upload time makes the UX painful; cross-reference URLs already work because MinIO/S3 don't enforce project-level object ACLs in this schema | Create new `Attachments` DB records pointing to existing URLs; no storage duplication needed |
| Shared cross-project test case library | "Why copy at all — just share cases across projects" | This is a fundamentally different data model (case ownership, access control, version divergence become complex); issue #79 explicitly out-of-scoped this | Copy/move is the right model for v0.17.0; a shared library is a separate architectural milestone |
| Automatic template creation in target project | "If the template doesn't exist, just create it" | Creating admin-owned templates during a user-triggered operation crosses a permission boundary; non-admins cannot create global templates | Admins get auto-assignment option; non-admins get a warning and can still proceed with field values dropped |

---

## Feature Dependencies

```text
[Bulk Copy/Move Dialog]
    └──requires──> [Project Picker (write-access filtered)]
    └──requires──> [Folder Picker (per selected project)]
    └──requires──> [Operation Selector (copy vs. move)]
    └──requires──> [Template Compatibility Check]
                       └──requires──> [TemplateProjectAssignment lookup for target]
    └──requires──> [Workflow State Mapping]
                       └──requires──> [ProjectWorkflowAssignment lookup for target]
    └──requires──> [Conflict Detection]
                       └──requires──> [Unique constraint pre-check: projectId+name+className+source]

[Async Bulk Processing (BullMQ)]
    └──requires──> [Copy/Move Job Worker]
    └──requires──> [Job Status Polling API]
    └──enhances──> [Progress UI]

[Progress UI]
    └──enhances──> [Bulk Copy/Move Dialog]

[Move operation]
    └──requires──> [Delete permission on source project]
    └──conflicts-with──> [Read-only source project access]

[Copy operation]
    └──requires──> [Write permission on target project only]
```

### Dependency Notes

- **Folder Picker requires Project Picker to resolve first:** The folder tree is project-specific; it cannot be shown until the target project is selected and its `RepositoryFolders` are loaded.
- **Workflow state mapping requires target project assignment:** Must query `ProjectWorkflowAssignment` where `projectId = targetProjectId` to find available states, then match or fall back.
- **Move requires delete on source:** ZenStack access policy for `RepositoryCases` delete maps to `canAddEdit` on `TestCaseRepository` area in source project. Enforce this server-side before deducting source records.
- **Shared steps dependency is isolated:** Shared step carry-over is orthogonal to other data carry-over. It can be deferred or simplified (inline expansion) without blocking the core feature.

---

## MVP Definition

### Launch With (v0.17.0)

Minimum viable feature — what's needed to make copy/move genuinely useful and safe.

- [ ] Copy/Move to Project dialog triggered from context menu and bulk actions toolbar — entry points users expect from existing UX patterns
- [ ] Target project picker filtered to projects where user has write access
- [ ] Target folder picker (with option for repository root)
- [ ] Operation selector: copy vs. move with clear consequence description ("Move removes cases from this project")
- [ ] Full data carry-over: name, steps, custom field values, tags, issue links, attachments (by URL reference)
- [ ] Template compatibility check: warn if target project has no matching template; admins get auto-assign option
- [ ] Workflow state mapping: match by name to target project's workflow states; fall back to target's default state
- [ ] Unique constraint collision handling: pre-check names before operation; prompt user with list of conflicting case names and offer skip/rename/overwrite options
- [ ] Async bulk processing via BullMQ for batches above a small threshold (reuse auto-tag job pattern)
- [ ] SSE or polling progress feedback visible in dialog
- [ ] Move preserves version history (update-in-place); copy starts at version 1
- [ ] Cross-project case links dropped on move/copy (documented in UI tooltip)

### Add After Validation (v0.17.x)

- [ ] Shared steps carry-over — either inline expansion into regular steps or creation of shared step group in target project; needs design decision and deeper research
- [ ] Cancel in-flight bulk operation — follow auto-tag cancel pattern via Redis flag
- [ ] Drag-and-drop cross-project move from TreeView (if UX validates the concept)

### Future Consideration (v2+)

- [ ] Cross-project test case shared library — explicit architectural milestone, out of scope per issue #79
- [ ] Per-case rename on conflict (vs. skip-all or abort-all) — adds complexity to conflict resolution UX; defer until users request it

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
| ------- | ---------- | ------------------- | -------- |
| Project + folder picker | HIGH | LOW | P1 |
| Copy vs. move operation selector | HIGH | LOW | P1 |
| Full data carry-over (steps, fields, tags, attachments, issues) | HIGH | MEDIUM | P1 |
| Template compatibility check + warning | HIGH | MEDIUM | P1 |
| Workflow state mapping | HIGH | MEDIUM | P1 |
| Unique constraint conflict prompt | HIGH | MEDIUM | P1 |
| Async bulk with progress (BullMQ + polling) | HIGH | MEDIUM | P1 |
| Move preserves version history | MEDIUM | LOW | P1 |
| Shared steps carry-over | MEDIUM | HIGH | P2 |
| Cancel in-flight job | MEDIUM | MEDIUM | P2 |
| Drag-and-drop cross-project from TreeView | LOW | HIGH | P3 |

**Priority key:**

- P1: Must have for launch (v0.17.0)
- P2: Should have, add when possible (v0.17.x)
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | TestRail | Zephyr Scale | BrowserStack TM | Our Approach |
| ------- | -------- | ------------ | --------------- | ------------ |
| Copy/move mechanism | Built-in UI wizard, drag-and-drop within suites | Export-to-XML then import — no native cross-project UI | Native UI: select cases, pick target project and folder | Native UI dialog; no export/import cycle |
| What transfers on copy | All field values, test results, history, linked defects | Cases and folder structure; custom fields require manual recreation in target | Not specified in available docs | Steps, field values, tags, issues, attachments; history on move, fresh on copy |
| Custom field handling | Fields transfer if same template exists in target | Must pre-create fields in target project manually | Not specified | Template compatibility check; warn on mismatch; admin auto-assign |
| Conflict resolution | Not documented; likely silent overwrite or error | Not documented | Not documented | Pre-check unique constraint; surface conflicts with skip/rename/overwrite options |
| Workflow state on transfer | States may differ per project; behavior not documented | Not documented | Not documented | Map by name to target project states; fall back to default |
| Bulk progress feedback | Not documented (likely synchronous for small counts) | Not applicable (async export/import) | Not documented | BullMQ job with polling progress |
| Shared steps | Not applicable (TestRail uses step references differently) | Not handled in cross-project scenario | Not documented | MVP: inline expansion; v0.17.x: proper carry-over |
| Links to cases in other projects | Not applicable | Not applicable | Not documented | Explicitly dropped; documented in UI |

---

## Sources

- [TestRail: Moving, copying, deleting and restoring test cases](https://support.testrail.com/hc/en-us/articles/7101747563028-Moving-copying-deleting-and-restoring-test-cases) — MEDIUM confidence (blocked on direct fetch; content from search snippet)
- [BrowserStack: Moving test cases across projects](https://www.browserstack.com/release-notes/en/moving-test-cases-across-projects) — MEDIUM confidence
- [BrowserStack: Copy and move folders across projects](https://www.browserstack.com/release-notes/en/test-management-copy-move-folders-across-projects) — MEDIUM confidence
- [SmartBear Community: Moving test cases between projects (Zephyr Scale)](https://community.smartbear.com/discussions/zephyrscale/moving-test-cases-from-one-project-to-another/213033) — MEDIUM confidence
- [Atlassian Community: Copy Xray Tests between projects retaining test steps](https://community.atlassian.com/t5/Marketplace-Apps-Integrations/How-can-I-copy-Xray-Tests-to-a-new-Project-retaining-all-the/qaq-p/1140339) — MEDIUM confidence
- [Bulk action UX guidelines](https://www.eleken.co/blog-posts/bulk-actions-ux) — MEDIUM confidence
- [UI patterns for async workflows and background jobs](https://blog.logrocket.com/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines) — MEDIUM confidence
- Codebase: `testplanit/app/api/repository/import/route.ts` — HIGH confidence (direct source inspection)
- Codebase: `testplanit/schema.zmodel` lines 1219-1268 — HIGH confidence (direct source inspection)
- Codebase: `testplanit/lib/queues.ts`, auto-tag worker patterns — HIGH confidence (direct source inspection)
- Project context: `.planning/PROJECT.md` (issue #79 requirements) — HIGH confidence

---
*Feature research for: cross-project test case copy/move (TestPlanIt v0.17.0)*
*Researched: 2026-03-20*
