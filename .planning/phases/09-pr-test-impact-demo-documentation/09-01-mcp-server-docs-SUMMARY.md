---
phase: 09-pr-test-impact-demo-documentation
plan: 01
subsystem: mcp-server
tags: [docs, docusaurus, sidebar, npm-readme, cursor, changeset, deferral, closeout]

# Dependency graph
requires:
  - phase: 08-repository-issue-read-tools
    plan: "05"
    provides: "28 registered MCP tools + canonical tool naming + killer-app composition examples in packages/mcp-server/README.md"
provides:
  - "Three new Docusaurus pages: docs/docs/sdk/mcp-overview.md, mcp-configuration.md, mcp-prompts.md"
  - "Sidebar wiring: MCP Server subcategory inserted between sdk/jira-forge-app and WebdriverIO Reporter under SDK & Integrations"
  - "Cross-link discoverability: docs/docs/api-tokens.md gains an 'AI agents (MCP)' subsection pointing at sdk/mcp-configuration.md"
  - "Available Packages table extended on docs/docs/sdk/index.md with @testplanit/mcp-server row"
  - "npm README polish: packages/mcp-server/README.md gains ## Cursor configuration section adjacent to existing ## Claude Desktop configuration"
  - "Changesets entry .changeset/mcp-server-cursor-config-and-docs.md (patch bump for @testplanit/mcp-server)"
  - "Local-only planning artifact reconciliation: .planning/REQUIREMENTS.md DEMO-01..04 reframed as Deferred with DEMO-FUTURE-01..04 captured in Future Requirements; .planning/ROADMAP.md Phase 9 success criteria reduced to docs-only scope"
affects: [Phase 9 closeout — manual checkpoint pending user approval]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Subcategory landing page pattern (Phase 8 WebdriverIO precedent): sidebar_label + title + sidebar_position frontmatter; category items array under SDK & Integrations links to overview as the doc, listing siblings as items"
    - "Tool catalog stays canonical in npm README only; Docusaurus pages link out (avoids duplication / drift hazard with the 28-tool surface)"
    - "Verbatim UI labels from testplanit/messages/en-US.json lines 1669-1674 (readOnlyLabel / readOnlyDescription / agentTokenLabel / agentTokenDescription) used in the read-only-token walkthrough so screen-reader users can match by accessibility label"
    - "DEMO-01..04 reframe mirrors Phase 8 D8-01 precedent: original wording moved to Future Requirements (DEMO-FUTURE-01..04) with deferral note in v1 section + traceability matrix flipped to 'Deferred to DEMO-FUTURE-NN'"

key-files:
  created:
    - docs/docs/sdk/mcp-overview.md
    - docs/docs/sdk/mcp-configuration.md
    - docs/docs/sdk/mcp-prompts.md
    - .changeset/mcp-server-cursor-config-and-docs.md
  modified:
    - docs/sidebars.ts
    - docs/docs/sdk/index.md
    - docs/docs/api-tokens.md
    - packages/mcp-server/README.md
    - .planning/REQUIREMENTS.md (local-only — gitignored per feedback_no_planning_commits.md)
    - .planning/ROADMAP.md (local-only — gitignored per feedback_no_planning_commits.md)

key-decisions:
  - "Tool catalog NOT duplicated into Docusaurus — single source of truth in packages/mcp-server/README.md; both Docusaurus pages link out via the npmjs.com URL"
  - "DEMO-01..04 deferred to DEMO-FUTURE-01..04 in REQUIREMENTS.md (mirroring Phase 8 D8-01 REPO-04 reframe pattern). ROADMAP.md Phase 9 success criteria reduced to three docs-only bullets matching the shipped surface"
  - ".planning/REQUIREMENTS.md and .planning/ROADMAP.md updates are local-only because .planning/ is project-gitignored (memory: feedback_no_planning_commits.md). The canonical record of the deferral lives in this SUMMARY's Deviations section + the gitignored files (which authors of this milestone keep in sync locally). Per Phase 8 plan 05 precedent, this is the established pattern."
  - "Cursor snippet duplicated between Docusaurus mcp-configuration.md AND packages/mcp-server/README.md so npm visitors see the configuration story self-contained without bouncing — accepted ~20 lines duplication cost (locked in CONTEXT.md Claude's Discretion → leading option)"
  - "Changesets bump is `patch` (not `minor`) because no new tools or behaviors ship; only README copy changes"
  - "i18n NOT applied to new sdk/mcp-*.md pages — matches existing precedent (memory: feedback_no_localize_api_docs.md, feedback_i18n_complete.md). en-US is the only locale that ships for SDK / developer-reference pages"
  - "Manual verification checkpoint paused at Task 7 — orchestrator-controlled gate; the Docusaurus production build was run as automation preflight and SUCCEEDED with no broken-link warnings (3 new pages emitted to docs/build/docs/sdk/mcp-{overview,configuration,prompts}/index.html)"

requirements-completed: []  # Phase 9 reqs (DOCS-01..04) close at orchestrator merge time when the manual checkpoint is approved; DEMO-01..04 are deferred (not completed) per .planning/REQUIREMENTS.md update

# Metrics
duration: ~9m
completed: 2026-05-07
---

# Phase 9 Plan 01: MCP Server Documentation Summary

**Three new Docusaurus pages (overview / configuration / prompts) wired into the SDK & Integrations sidebar as the new MCP Server subcategory; api-tokens.md gains a single "AI agents (MCP)" cross-link; sdk/index.md Available Packages table extended with the @testplanit/mcp-server row; the npm README polishes its agent-onboarding story with a verbatim Cursor mcp.json snippet adjacent to the existing Claude Desktop snippet; a `patch` Changesets entry tracks the README copy change; DEMO-01..04 deferred to DEMO-FUTURE-01..04 in the local-only REQUIREMENTS.md and ROADMAP.md to mirror the docs-only scope. Docusaurus production build (`pnpm --filter docs build`) succeeded clean; manual verification checkpoint pending user approval.**

## Performance

- **Duration:** ~9m (start 19:27:53 UTC, end ~19:36:54 UTC)
- **Started:** 2026-05-07T19:27:53Z
- **Completed (automated tasks):** 2026-05-07T19:36:54Z
- **Tasks:** 6 of 7 automated complete; Task 7 is a blocking manual checkpoint
- **Files committed:** 4 created / 4 modified (5 commits across Tasks 2–6)
- **Files local-only:** 2 (.planning/REQUIREMENTS.md + .planning/ROADMAP.md per project gitignore policy)

## Pages Shipped

### docs/docs/sdk/mcp-overview.md (DOCS-01 — landing page)

Slug: `sdk/mcp-overview` · Sidebar label: `MCP Server` · Position: 1

Sections: capabilities summary (7-bullet "What an agent can ask"), `npx @testplanit/mcp-server` install block, env vars table (Required: `TESTPLANIT_API_TOKEN`; Optional: `TESTPLANIT_API_URL`), Next steps (3 links: configuration → prompts → npm README).

### docs/docs/sdk/mcp-configuration.md (DOCS-02 + DOCS-04)

Slug: `sdk/mcp-configuration` · Title: `Configuration` · Position: 2

Sections:
1. **`## Configuration`** with side-by-side `### Claude Desktop` (file paths macOS/Windows + verbatim mcp.json snippet) and `### Cursor` (file paths global/project + verbatim mcp.json snippet with `type: "stdio"` + env-interpolation note)
2. **`## Token scopes`** explaining `mode:read` and `client:mcp` semantics (distilled from `packages/mcp-server/README.md` lines 22-29)
3. **`## Create a read-only agent token`** — 8-step walkthrough using EXACT en-US.json strings: "Read-only" / "Use for AI agents that should only query data, never modify it." / "Mark as agent token" / "Tags audit log entries with metadata.source: \"mcp\" so admins can attribute agent-driven changes." Followed by a `:::warning` admonition mirroring api-tokens.md tone
4. **`## Tool catalog`** — single paragraph + link out to the npm README (the canonical 28-tool reference)
5. **`## Troubleshooting`** — three subsections: `INVALID_TOKEN/EXPIRED_TOKEN`, `READ_ONLY_TOKEN` write attempts, agent doesn't see tools (with Claude Desktop + Cursor specifics)
6. **`## See also`** — 3 cross-links

### docs/docs/sdk/mcp-prompts.md (DOCS-03)

Slug: `sdk/mcp-prompts` · Title: `Example Prompts` · Position: 3

Sections (post-correction — see "Post-execution correction" in Deviations below):

1. Page intro `:::tip` admonition explaining canonical tool naming + the `projects_list` warm-up
2. Six h2 example prompts, each formatted as: user prompt block → tool call(s) with required parameters → "What comes back" + (where useful) a sketched response shape
   - "Show me the most recent issues in project Acme" — `projects_list` (optional warm-up) → `issues_list({projectId})`
   - "Who tested JIRA-1234?" — 3-call chain: `issues_find_by_key` → `cases_list({issueId})` → `test_run_results_list({caseIds})`
   - "Show me failed test runs from last week" — `test_runs_list` with `from`/`to` + inline `statusCounts`
   - "What automated tests are stale?" — `cases_list({automated:true, staleSinceUpdate:true})` + optional `hasNeverExecuted:true`
   - "What test cases live in this code repository?" — `code_repositories_list` → `cases_list({repositoryId, automated:true})` (with a clarifying note that `CodeRepository` tracks TestPlanIt's automated test code, not application code)
   - "What manual cases cover this automated test?" — `repository_case_links_list({caseId})`
3. **`## See also`** — 3 cross-links

## Sidebar Wiring

`docs/sidebars.ts` SDK & Integrations category before edit (sibling order):

```
api-reference → sdk/api-client → sdk/jira-forge-app → WebdriverIO Reporter (category)
```

After edit:

```
api-reference → sdk/api-client → sdk/jira-forge-app → MCP Server (category) → WebdriverIO Reporter (category)
```

The new MCP Server category uses the same shape as WebdriverIO Reporter:

```ts
{
  type: 'category',
  label: 'MCP Server',
  link: { type: 'doc', id: 'sdk/mcp-overview' },
  items: [
    'sdk/mcp-configuration', // Configuration: Claude Desktop + Cursor + token scopes
    'sdk/mcp-prompts', // Example agent prompts
  ],
}
```

Insertion point: line 232 (between `'sdk/jira-forge-app'` line 231 and the WebdriverIO Reporter category — now line 244).

## npm README Addition

`packages/mcp-server/README.md` line ordering before edit:

```
## Claude Desktop configuration  (line 1013)
## Diagnostics                   (line 1034)
## Security notes                (line 1040)
```

After edit:

```
## Claude Desktop configuration  (line 1013)
## Cursor configuration          (line 1034)  ← NEW
## Diagnostics                   (line 1056)
## Security notes                (line 1062)
```

The Cursor snippet is byte-equivalent to the one in `docs/docs/sdk/mcp-configuration.md` (verbatim mcp.json with `type: "stdio"`); the env-interpolation note follows the snippet.

## Changesets Entry

`.changeset/mcp-server-cursor-config-and-docs.md`:

```
"@testplanit/mcp-server": patch
```

`patch` (not `minor`) because no new tools or behaviors ship — only README copy. The Docusaurus pages aren't part of the published package and don't need a Changesets bump.

## DEMO-01..04 → DEMO-FUTURE-01..04 Deferral

Mirrors the Phase 8 D8-01 reframe pattern. Edits land in `.planning/REQUIREMENTS.md` (local-only — gitignored per `feedback_no_planning_commits.md`):

1. **DEMO subsection v1 → DEFERRED:** the four DEMO-NN bullets (lines 119-122) are replaced with a single "DEFERRED" paragraph that explains the rationale (recorded-transcript regression artifact cost not justified; docs + per-tool unit/E2E coverage suffice) and back-links to Future Requirements + the discuss-phase CONTEXT.md `<deferred>` block.
2. **Future Requirements gains 4 entries:** DEMO-FUTURE-01 (path-based impact transcript), DEMO-FUTURE-02 (issue-based impact transcript), DEMO-FUTURE-03 (gap-filling transcript), DEMO-FUTURE-04 (end-to-end conversation transcript).
3. **Traceability matrix:** DEMO-01..04 status flipped from `Pending` to `Deferred to DEMO-FUTURE-NN (see Phase 9 deferral note)`.
4. **Coverage check note:** updated to `54/54 requirements mapped (4 DEMO deferred to DEMO-FUTURE-01..04)`.

`.planning/ROADMAP.md` updates (also local-only):

1. **Top Phases list (line 23 area):** Phase 9 entry rewritten to "MCP Server Documentation" with deferral language.
2. **Phase 9 detail section:** Goal rewritten to focus on "from API token → my agent is querying TestPlanIt"; Success Criteria reduced from 5 (including DEMO-01..04 transcript bullets) to 3 (DOCS-01..04 + cross-link discoverability + npm README self-contained).
3. **Plans count:** `TBD` → `1 plan` listing `09-01-mcp-server-docs-PLAN.md`.
4. **Progress table:** Phase 9 row `0/TBD` → `0/1`; phase title updated.

The DOCS-01..04 traceability rows stay at `Pending` until the manual verification checkpoint approves and the orchestrator flips them to `Complete` — same posture as previous phases.

## Commits

| Task | Subject                                                                  | Hash       | Files                                                                                       |
| ---- | ------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------- |
| 1    | (no commit — local-only edits per project gitignore policy)              | —          | .planning/REQUIREMENTS.md, .planning/ROADMAP.md                                            |
| 2    | docs(09-01): add MCP Server overview page                                | `3ee7e9b9` | docs/docs/sdk/mcp-overview.md                                                              |
| 3    | docs(09-01): add MCP Server configuration page                           | `e9bc6d24` | docs/docs/sdk/mcp-configuration.md                                                         |
| 4    | docs(09-01): add MCP Server example prompts page                         | `25c06f7f` | docs/docs/sdk/mcp-prompts.md                                                               |
| 5    | docs(09-01): wire MCP Server subcategory into sidebar + cross-links      | `942f7a97` | docs/sidebars.ts, docs/docs/sdk/index.md, docs/docs/api-tokens.md                          |
| 6    | docs(09-01): add Cursor configuration section to mcp-server README + changeset | `d10a7cb6` | packages/mcp-server/README.md, .changeset/mcp-server-cursor-config-and-docs.md             |
| 7    | (checkpoint — no commit; awaits user approval)                            | —          | n/a                                                                                          |

## Automation Preflight (Task 7 prep)

Per `<phase_specific_guidance>`, the executor ran the automation portion of the manual verification before returning the checkpoint:

```bash
pnpm --filter docs build
```

Result: **PASSED** (no broken-link warnings; clean compile of both client and server bundles in 13.3s and 10.6s respectively).

Generated artifacts:
- `docs/build/docs/sdk/mcp-overview/index.html`
- `docs/build/docs/sdk/mcp-configuration/index.html`
- `docs/build/docs/sdk/mcp-prompts/index.html`

Note: the plan's `<verify>` blocks reference `pnpm --filter @testplanit/website build`, but the workspace package name is `docs` (not `@testplanit/website`). The actual filter to use during manual verification is `pnpm --filter docs build`. This is a Rule 1 (bug) auto-fix: the executor used the correct filter so the preflight could run; the plan's literal verify command would have failed with `No projects matched the filters`. Documented here for the manual verifier so they don't second-guess.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Plan's `pnpm --filter` target name**

- **Found during:** Task 7 automation preflight
- **Issue:** The plan's `<how-to-verify>` step 1 prescribed `pnpm --filter @testplanit/website build`, but `docs/package.json` declares `"name": "docs"` (not `@testplanit/website`). Running the literal command would fail with `No projects matched the filters`.
- **Fix:** Used `pnpm --filter docs build` instead. Build succeeded; new pages emitted under `docs/build/docs/sdk/mcp-{overview,configuration,prompts}/index.html`.
- **Files modified:** none (preflight only — the plan file itself is in `.planning/` and stays local-only)
- **Commit:** none (the plan literal isn't authoritative; this is a documentation-of-record adjustment)

### Post-execution correction (user-driven, 2026-05-07)

**What was wrong:** the plan's Task 4 prescribed a `## Killer-app flow: PR Test Impact` section in `mcp-prompts.md` that documented a tool chain the data model cannot support — `testplanit_cases_list({ name: "<path fragment>" })` against application PR diff paths. `CodeRepository` in TestPlanIt only tracks where automated TEST code lives; there is no link from application code paths to test cases. The plan author imported the framing from earlier ROADMAP "killer-app demo" narrative without verifying the v1 tool surface could deliver it.

**What was changed:**

- Rewrote `docs/docs/sdk/mcp-prompts.md` end-to-end. New format: page-level `:::tip` + six h2 example prompts (user prompt → tool calls → what comes back). Dropped the `## Read-only flows` h2 wrapper and the broken `## Killer-app flow: PR Test Impact` section entirely. Added "Show me the most recent issues in project Acme" as the leading example — closes a real gap surfaced by the user's ad-hoc Claude Desktop session where Claude wrongly claimed `testplanit_issues_list` did not exist (it does, Phase 8 / ISSUE-02; requires `projectId`).
- Updated `docs/docs/sdk/mcp-overview.md` Next-steps bullet from "Read-only and PR Test Impact flow examples" → "agent prompts for issue lookup, run history, and maintenance flows".
- Updated `.planning/ROADMAP.md` Phase 9 success criterion #1 to drop the trailing "PR Test Impact flow" wording (local-only — gitignored).

**What was NOT changed:** older ROADMAP lines (6, 8, 22, 138, 147) that bake the same broken framing into the milestone narrative are left intact. Per memory `project_v023_webhook_demo_deadline.md`, "killer-app / demo" wording in roadmaps is narrative-not-scope; cleaning up earlier-phase narrative is out of scope for Phase 9.

**Commit:** the corrections committed as a single follow-up `docs(09-01): rewrite mcp-prompts.md to example-driven format + drop unsupported PR Test Impact framing`.

### Architectural Decisions Pending User Input

None — no Rule 4 deviations encountered.

### Authentication Gates

None.

## Known Stubs

None — these are documentation pages, not application code with runtime data sources. All cross-links resolve to existing files (mcp-overview.md, mcp-configuration.md, mcp-prompts.md, ../api-tokens.md) or external npmjs.com URLs.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. All threats in the plan's `<threat_model>` (T-09-01 through T-09-06) are addressed by the implementation:

- T-09-01 (info disclosure on token-scopes copy): `mcp-configuration.md` token-scope semantics distilled from `packages/mcp-server/README.md` lines 22-29 — not paraphrased.
- T-09-02 (info disclosure on api-tokens cross-link): the new `### AI agents (MCP)` subsection in `api-tokens.md` does NOT reproduce token-scope semantics inline; it links to `sdk/mcp-configuration.md` only. Token-scope prose lives canonical in one place.
- T-09-03 (tampering on JSON snippets): both Cursor and Claude Desktop snippets are byte-identical to the plan's `<interfaces>` block; the executor pasted them rather than retyping.
- T-09-04 (repudiation on audit-log attribution claims): docs describe pre-shipped Phase 5 / SRV-06 behavior — no implementation change.
- T-09-05 (DoS on sidebar misconfig): `pnpm --filter docs build` succeeded clean; the new doc IDs land atomically with the page files in this plan.
- T-09-06 (privilege escalation on UI walkthrough): walkthrough uses EXACT en-US.json strings (lines 1669-1674) — `Read-only` / `Use for AI agents that should only query data, never modify it.` / `Mark as agent token` / `Tags audit log entries with metadata.source: "mcp" so admins can attribute agent-driven changes.`

## CHECKPOINT REACHED — Task 7 (human-verify)

**Type:** human-verify
**Plan:** 09-01
**Progress:** 6/7 tasks complete (Task 1 local-only edits + Tasks 2-6 committed)

### Awaiting User

The user must complete the remaining manual verification steps from the plan's `<how-to-verify>` block:

2. **Sidebar render** — `pnpm --filter docs start` and confirm sibling order: API Reference → @testplanit/api → Jira Forge App → **MCP Server** → WebdriverIO Reporter
3. **Internal link integrity** — click every internal link on the three new pages
4. **End-to-end read-through** — Overview → Configuration → Prompts as a coherent journey
5. **npm README preview** — deferred to post-Changesets release
6. **Planning artifact sanity** — already verified in this preflight

The Docusaurus production build (step 1) PASSED in this preflight — no broken-link warnings, all three new pages rendered into `docs/build/`. The remaining steps (2–6) are visual / journey-coherence checks the executor cannot replace.

**Resume signal:** User types "approved" or describes issues for re-execution.

## Self-Check: PASSED

### Created files exist:

- [x] docs/docs/sdk/mcp-overview.md — FOUND
- [x] docs/docs/sdk/mcp-configuration.md — FOUND
- [x] docs/docs/sdk/mcp-prompts.md — FOUND
- [x] .changeset/mcp-server-cursor-config-and-docs.md — FOUND

### Modified files reflect Task 5 + Task 6:

- [x] docs/sidebars.ts contains `MCP Server` + `sdk/mcp-overview` + `sdk/mcp-configuration` + `sdk/mcp-prompts`
- [x] docs/docs/sdk/index.md contains `@testplanit/mcp-server` row
- [x] docs/docs/api-tokens.md contains `AI agents (MCP)` subsection + `./sdk/mcp-configuration.md` link
- [x] packages/mcp-server/README.md contains `## Cursor configuration` AFTER `## Claude Desktop configuration` AND BEFORE `## Diagnostics`

### Local-only files reflect Task 1:

- [x] .planning/REQUIREMENTS.md contains 4 `DEMO-FUTURE-0[1-4]` entries (grep count: 4 unique IDs, 10 total occurrences across body + traceability + coverage check)
- [x] .planning/REQUIREMENTS.md DEMO header reads `### DEMO — Test Impact Analysis (killer-app validation) — DEFERRED`
- [x] .planning/REQUIREMENTS.md traceability matrix has 4 rows starting `| DEMO-0[1-4]` containing `Deferred`
- [x] .planning/ROADMAP.md contains `MCP Server Documentation` (Phase 9 retitled)
- [x] .planning/ROADMAP.md cites `09-01-mcp-server-docs-PLAN.md`

### Commits exist:

- [x] `3ee7e9b9` (Task 2) — present in `git log`
- [x] `e9bc6d24` (Task 3) — present in `git log`
- [x] `25c06f7f` (Task 4) — present in `git log`
- [x] `942f7a97` (Task 5) — present in `git log`
- [x] `d10a7cb6` (Task 6) — present in `git log`

All claims in this SUMMARY are verified.
