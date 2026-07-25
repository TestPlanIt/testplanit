**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.8

#### Performance

- **Much faster page loads on large projects** — access control was overhauled
  so your project access is resolved once per request instead of being
  re-checked row by row inside every database query. On the largest test
  project, rendering the repository list dropped from ~36 seconds of database
  time to a flat indexed lookup. Access rules themselves are unchanged: the
  rewrite ships with a differential test that checks every permission
  combination against the previous policy, plus live-database read and write
  tests.

#### Fixes

- **Run auto-lock works again** — moving a run to In Progress with the
  project's auto-lock composition option enabled failed with an error; the
  lock is now applied correctly.
- **One Back click to leave the repository** — opening the repository no
  longer adds an extra browser-history entry, so the Back button behaves as
  expected.
- Resizable table columns now honor their widths reliably, long case names
  ellipsize instead of clipping, and in narrow columns the folder chip
  collapses before the case name does.

#### Interface

- **Modernized top navigation** — on narrow screens the header action icons
  collapse into a kebab menu, with alerts surfaced on the collapsed menu;
  project and admin menus got smaller, tidier icons.
- **One run details page** — manual and JUnit run details now share a single
  unified page, and the completed-run badge is more compact, collapsing its
  date when space is tight.
- Clearer wording on the pending-review banner.

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
