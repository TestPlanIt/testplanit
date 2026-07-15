**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.3

#### Milestones

- Burndown chart on the milestone detail page, with a variance/heat strip and a
  "% ready" release-readiness rollup on the Issues section
- New milestone-readiness report, plotted on a time axis
- Quick-generate test cases directly from the scope-issues table (LLM-assisted)
- Detail-page overhaul: collapsible persisted accordions, virtualized run/session
  lists, a milestone-kind filter, and a per-case traceability matrix in the PDF export
- An activity-log section on the milestone detail page
- Jira Server/Data Center: milestone-membership sync; compact "managed by Jira"
  notice; a Milestones linkage column on the Issues tables

#### Attachments

- Inline preview of Word, Excel, and PowerPoint documents
- Attachment filtering and localization; full-height PDF previews with carousel
  keyboard navigation

#### Test runs & sessions

- Distribute test-case assignments across team members
- Webhooks emit `test_run.duplicated` / `session.duplicated` on duplicate
- Fixed iteration result recording stalling on a page-wide refetch

#### Audit log

- Edits attribute to the acting user (admin config, milestones, projects, comments)
- Rich-text description edits are recorded, and JSON diff columns now render
  readably instead of showing `[object Object]`

#### Platform & fixes

- Configurable API rate limit (`API_RATE_LIMIT`)
- Single-default-per-catalog enforced atomically via database triggers
- Testmo import no longer writes the Jira key into the external id
- PDF exports handle non-Latin text; steadier live-stream connections and fewer
  reconnect refetch storms; no more theme-change flash on load
- Dependency bumps, translation syncs, and documentation updates

### Try it

1. Download **Source code (zip / tar.gz)** from the Assets below (or
   `git checkout` this tag).
2. Configure your environment:
   ```bash
   cp testplanit/.env.example testplanit/.env.production   # then fill in values
   ```
3. Build and run (the compose file builds from source):
   ```bash
   docker compose -f testplanit/docker-compose.prod.yml up -d --build
   ```
   Serving multiple subdomains off one image? Build with your own wildcard:
   `--build-arg BASE_DOMAIN=<your-domain>`.
4. **Upgrading an existing database?** v3 uses versioned migrations. Run the
   one-time baseline **before** first boot, then start normally (the container
   applies the rest on startup):
   ```bash
   cd testplanit
   npx zenstack migrate resolve --applied 20260625193632_init --schema schema.zmodel
   ```

Full walkthrough: **https://docs.testplanit.com/docs/building-from-source**

Found a problem? [Open an issue](https://github.com/TestPlanIt/testplanit/issues/new)
and add the **beta** label.
