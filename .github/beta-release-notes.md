**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.5

#### Test runs & sessions

- **Execution-start composition lock** — freeze which cases are in a run
  (adding, removing, reordering) while execution and assignment keep working,
  so a run's scope can't shift out from under people mid-execution. Turn it on
  per run from the run header, or auto-lock every run when it enters an
  in-progress state (a per-project setting). Distinct from the completion lock,
  which freezes everything permanently.

#### AI & QuickScript

- **QuickScript generation is now available outside the app** — generate AI test
  scripts through an API token, the MCP server, and the Jira (Forge) plugin, not
  just the in-app modal
- Code-repository content now caches in a single archive download (~2s instead
  of ~145s, with no per-file rate limits), and QuickScript sizes its repository
  context from the model's context window instead of an output-token default
  that could starve generation of any code context
- AI admin pages — AI Models, Prompt Configurations, QuickScript Templates, and
  Code Repositories — are now grouped under a dedicated **AI Tools** section in
  the admin menu

#### Record keys

- **Optional project-prefixed record identifiers** — turn on cosmetic keys like
  `PROJECT-TC-1234` (project code + type token + the existing numeric id).
  Opt-in and purely additive: the numeric id stays canonical, URLs resolve with
  or without the prefix, and keys surface in global search, exports, webhook
  payloads, and the audit log

#### Accessibility

- **New Accessible Dark theme** — a WCAG 2.2 AA-conformant dark counterpart to
  the Accessible theme, for users who need a dark UI (e.g. light sensitivity).
  This also fixes a pre-existing bug where the existing Accessible theme wasn't
  registered in every view, so it wouldn't survive a reload or a share link

#### Admin

- **Trash redesigned** as a sidebar master-detail layout — a filterable
  item-type rail with per-type count badges and a detail pane that loads records
  with virtualized fetch-on-scroll infinite loading, replacing the stacked
  accordions

#### Integrations & webhooks

- Issue webhook events now fan out to **every project linked to the issue**
  (through its linked cases, runs, or sessions), not just the issue's home
  project — and integration-only issues with no home project now emit too,
  rather than silently sending nothing

#### Platform & fixes

- Upgrade notifications now compare versions by proper SemVer precedence,
  including pre-releases, so in-range notifications are no longer silently
  dropped for beta builds
- Dependency updates across the workspace

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
