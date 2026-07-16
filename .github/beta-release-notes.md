**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.4

#### Test data & CI

- Row-level lease primitive for datasets: parallel test runs can reserve
  distinct dataset rows without colliding, with acquire / release / extend
  guarded by a per-lease fencing token and automatic expiry of stale leases

#### Test runs & sessions

- Custom-field columns on the test-run detail page now show formatted values —
  Dropdown / Multi-Select option labels and rendered rich text — instead of raw
  option ids or raw editor JSON
- Test run and session names now carry an icon for quicker visual scanning

#### Repository

- The inline "add case" row keeps focus after you add the first case, so you can
  add several cases in a row without clicking back into the field

#### Platform & fixes

- The in-app version now reflects the beta you built from (e.g.
  `v1.0.0-beta.5`) instead of the underlying package version
- Soft-deleted records now record a `deletedAt` timestamp, stamped by a database
  trigger — the basis for time-based retention and purging of old soft-deleted
  data
- Table cells expose a `data-column-id` attribute for improved accessibility
- Continued end-to-end test-suite hardening for steadier runs

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
