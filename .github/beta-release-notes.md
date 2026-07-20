**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.6

#### Test case repository

- **Docked test case details** — clicking a case now opens its full details in a
  panel beside the list instead of navigating away, so you keep your place. The
  divider is draggable (with a full-width toggle), and prev/next steps through
  the whole filtered result set — across page boundaries — while the open case's
  row stays highlighted in the list. On narrow screens the panel takes over the
  full width automatically.
- **Refreshed data table** — case-list rows now sit on a neutral surface with a
  matching grid on both axes, with higher contrast in the Accessible and
  Accessible Dark themes and a row hue tuned per theme.
- **Latest results at a glance** — the list shows a case's most recent results
  rather than only the single last one, and you can sort the list by the status
  of that latest result.
- **Clearer drag-to-reorder** — dragging a case now outlines where it can be
  dropped and what dropping there will do.

#### Fixes

- Long text-field values size to their content and honor a configured initial
  height in the editor, instead of being clipped or over-tall.
- Block drag-and-drop no longer misbehaves on pages that provide their own
  react-dnd backend.
- Attachment names that are too long to fit now truncate with an ellipsis in the
  details view.

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
