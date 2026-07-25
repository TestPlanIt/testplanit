**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.9

#### Access control

- **Default-access members can edit again** — users whose only path into a
  project is its default access setting could read everything but were denied
  edits on most models (folders were the visible symptom). Write rules now
  honor default access the same way reads do, across all fifteen affected
  models.
- **Group access through global roles resolves correctly** — the permissions
  endpoint mishandled groups granted access via a global role, so members of
  those groups could see wrong project permissions.

#### Fixes

- **Creating a test case works with fields left empty** — saving a case with
  an unset optional field (a dropdown with no default, for instance) failed
  with "Invalid input data". The same latent issue was closed in result
  submission, bulk edit, saved searches, and case search.
- **No more vanishing test cases** — a remembered "Latest Results" sort could
  render run pages and folder switches with an empty (or partially missing)
  case list. Sort state that a view can't serve now falls back to the default
  order, and the sorted page always matches the selected folder.
- **Disabled items stay out of pickers** — disabled workflow states,
  templates, fields, and dropdown options no longer appear when creating or
  editing cases and results (an edited item's current value still displays,
  even if since disabled). Admin management pages still show everything so
  disabled items can be re-enabled.
- Comment editors now support @-mentions consistently.
- The session form shows a clear message when a session has no attachments.

#### Reviews

- **Pending-review badges wherever runs and sessions appear** — milestone
  pages, the home dashboard, profile assignments, and the project overview now
  mark runs and sessions that have a review waiting, matching the badge test
  cases already show. Runs not scheduled to a milestone were missing the badge
  on the runs list; fixed, and the badge now aligns cleanly with the name.

#### Interface

- Case action bars collapse into a kebab menu when space is tight, and folder
  chips give way to case names consistently in every view.
- Your Assignments on user profiles: pending reviews, open runs, and active
  sessions in one place, scoped to what the viewer may see.
- Cleaner admin tables — SSO, SCIM, and queue management share the standard
  table with a pinned first column.
- Idle self-hosted and multi-tenant installs use noticeably less CPU thanks to
  adaptive background polling.

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
