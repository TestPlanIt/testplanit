**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.13

#### Test runs & sessions

- **The lists handle long projects properly now** — run and session tiles are
  windowed inside each milestone group and in the all-completed view, so only
  what's on screen is rendered. The lists scroll with the page instead of in a
  nested pane, and opening one no longer prefetches a detail page for every
  other tile in view. Drag-to-reorder has been removed from the runs list.
- **Start and end dates on runs and sessions** — start comes from the earliest
  result recorded, end from the latest. End only appears on completed runs and
  sessions: an open one's newest result is the last thing that happened, not an
  ending.
- **Live updates target the run that changed** — a result landing used to wake
  every tile in the list; it now invalidates just the run it belongs to, and a
  burst of results is coalesced into one refresh.
- **Summary cards fill the width available** on both lists.
- Editing a case in place from the execution panel keeps its state out of the
  URL, so browser back and forward behave as expected.
- Child milestones rank the same way here as in every other milestone list.

#### Milestones

- Child milestone rows and the milestone pickers show the full, self-collapsing
  source badge instead of a bare glyph, so a milestone synced from Jira is
  identifiable wherever it appears.
- Child milestones order consistently across every list that shows them.

#### Sharing & links

- **A shared link now previews as what it points to.** Pasting a TestPlanIt URL
  into Slack, Teams, or iMessage produced the same generic card whatever it
  linked to, because the preview fetch has no session and was being sent to the
  sign-in page. Runs, cases, sessions, projects, and milestones each get their
  own card. By default the card names only the *kind* of record, so nothing
  private reaches a channel; set `LINK_PREVIEW_MODE=names` to show record and
  project names instead — anyone who can reach the link then sees them without
  signing in, so enable it only where that's acceptable.

#### Repository & import

- **Imports no longer fabricate steps or erase step history.** A result that
  named a step order the case no longer has is routine — Testmo snapshots the
  step list into each result at execution time — but it caused a live step row
  to be created for the miss.
- **Re-importing an unedited export works.** A TestPlanIt export carries each
  case's own ID and Version columns, so re-importing one asked for a version
  snapshot that already existed and failed the row; the import now allocates a
  free version instead.
- Sorting by the Steps column counts only live steps, so the order matches the
  number the column shows.

#### Integrations

- **An integration whose credentials can't be read now says so.** Rather than
  sending a value it couldn't decrypt, it refuses the request and reports what
  to do — re-enter the credentials and save. Errors surfaced from providers are
  typed and actionable instead of generic failures.

#### Operations & self-hosting

- **Auth rate limits are shared across instances.** Both limiters counted
  attempts in a per-process map, so a load-balanced pair kept separate counters
  and the effective allowance roughly doubled. They now share state via Valkey.
- **`/api/health` reports event-loop lag** (`p50` / `p99` / `max`, in
  milliseconds). The app serves every request from a single JS thread, so this
  is the capacity signal container CPU% can't show. It's reported for monitoring
  only and never changes the overall status, so it won't flap a liveness probe.
- **nginx logs request timing**, and the bundled config loads an http-context
  include so a deployment can supply its own upstream block.
- **The request body ceiling is overridable per deployment.** It was pinned
  inside `location /`, where a per-host override was impossible without editing
  the tracked file. See `nginx-local/README.md`.

#### Fixes & interface

- The loading spinner in async dropdowns stays inside the dropdown instead of
  drifting outside it before the first page of results lands.
- In-review filter labels refined across six locales.

#### Documentation

- File Storage listed a configurable 100MB maximum per file. The real limits are
  per upload type — 10MB for attachments and inline document images, 4MB for
  project icons, 2MB for avatars — with the bundled nginx capping request bodies
  at 10MB on top of that.

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
