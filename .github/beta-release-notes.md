**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.7

#### Reviews

- **Bulk review requests** — request approvals for many cases at once from the
  case bulk-edit panel, with a breakdown of what will be requested and what's
  skipped.
- **Approving applies the transition** — approving a review request now performs
  the workflow state change it was gating, so the work moves forward
  automatically.
- **Pending reviews up front** — reviews awaiting you surface at the top of Your
  Assignments on the dashboard, and the inbox badge count updates live.
- The assignee picker now includes group GLOBAL_ROLE holders, and an assigned
  reviewer can always open their own request.

#### Test case repository

- **Customizable columns** — reorder and resize the case-list columns and your
  layout is remembered; a new column-header menu adds quick sort and hide, with
  your sort remembered too.
- **"Show all descendants" polish** — prev/next in the details panel now spans
  every case in the view, and you can sort by latest-result status there too.
- Steps are visible again for read-only and group-role users; the Generate Test
  Cases button is hidden when no AI model is configured (it did nothing without
  one); and sorted column headers get a lighter, less-heavy look.

#### Automated test integration

- The WebdriverIO reporter can now match cases by a custom field value (e.g. an
  external ID) and mark matched cases as automated.

#### Consistency & polish

- A broad UI-consistency pass across the admin area (Users, Roles, Tags, Issues,
  System, Authentication, Tools & Integrations, AI Tools) and project pages —
  unified page headers, action bars, and controls.

#### Reliability & self-hosting

- Live updates no longer livelock behind slow queries when issues change.
- Integration credential caching is now tenant-scoped and invalidates across
  processes when credentials change; Jira OAuth issue links use the canonical
  site host.
- Self-hosting: nginx supports local overrides and custom error pages, the
  container healthcheck no longer reports a false "unhealthy", `SELF_HOSTED` is
  wired into the production build args, a generic production compose file is
  back, and database connection pools are sized per service.
- The first-run preferences dialog can now be closed.

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
