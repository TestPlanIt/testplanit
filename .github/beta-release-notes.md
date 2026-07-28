**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.10

#### Test automation reporters

- **Attach links, files, and metadata to the run itself** — the WebdriverIO
  and Playwright reporters accept declarative `runLinks`, `runAttachments`,
  and `runMetadata` options (with `{env:VAR}` templating), and tests can add
  to the run at runtime via `browser.testplanit` (WebdriverIO) or
  `attachToRun` (Playwright). Files produced during the run are picked up at
  completion.
- **Automated runs show Description and Documentation** — the run page
  rendered the JUnit results panel instead of the two editors, so run-level
  content — including metadata written by the reporters — was invisible.
  Both now render and edit on automated runs just like manual ones.

#### Generate Test Cases

- **Per-template default fields** — admins can exclude template fields from
  AI generation by default (sparkles toggle in Add/Edit Template). The wizard
  seeds its selection from those defaults; required fields stay on, and any
  optional field can still be toggled per run.
- **Deselecting a field now sticks** — the wizard silently re-selected every
  field when moving between steps, and the model could volunteer a deselected
  field anyway; deselected fields are now excluded end to end. Cases linked
  to the selected issues are also fed to the model as context.

#### Jira milestone sync

- The import picker filters by Release / Sprint, and the import button counts
  what's selected.
- Milestone preview filters in Jira instead of client-side — faster with many
  versions — and gateway errors surface properly instead of an empty list.
- Sprint import requests the granular Jira Software scopes it needs; the
  required OAuth 2.0 scopes are now documented.
- Webhook handling tuned: version/sprint lifecycle transitions (release,
  close, start, complete) always apply immediately, refreshes coalesce only
  during a real event storm, and inbound issue syncs get the same burst
  allowance as other webhooks. The Deliveries tab gained an event filter.
- Version events resolve to the correct project, and issue tracker-key
  lookups are indexed.

#### Results & runs

- **Run status follows edited and deleted results** — editing a result from
  Passed to Failed (or deleting one) updated the history but left the run's
  donut and the case's status chip showing the old outcome. The case status
  is now re-derived whenever a result changes.
- **Linking an issue marks the result failed** — attaching an issue in the
  Add/Edit Result dialog flips the status to the project's first failure
  status automatically; a failure status you already picked is kept.
- Expanding an attachment now shows just the attachment, scaled to fit the
  viewer.

#### Reviews

- **Deleting a case, run, or session cancels its pending reviews** —
  reviewers no longer keep inbox entries pointing at work that no longer
  exists.
- Reviews inbox table: column widths and resizing are honored, long names
  truncate with an ellipsis, and links and status chips render at the right
  scale.

#### Fixes & interface

- Disabled fields no longer appear in bulk edit or the case details view.
- Numbers format with the app's locale instead of the browser's.
- Translated strings no longer drop counts (machine translation was mangling
  the ICU `#` placeholder).
- The Add Session form no longer discards values you typed while it finished
  loading.
- Tables with pinned columns keep scrolled-to cells reachable instead of
  hiding them under the pinned edge.
- Milestone page side panels collapse to give the middle section more room,
  and the project overview leads with the test case breakdown chart.

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
