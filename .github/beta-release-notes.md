**Beta pre-release of TestPlanIt 1.0 — source only.**

> 🔒 **This is the release candidate for 1.0** (superseding beta.19). The beta
> channel is locked: barring showstoppers, this build is what graduates to
> `main` as **v1.0.0**. Only critical fixes land between now and release — if
> you've been waiting to try the beta, this is the one to test.

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.19

#### Upgrade documentation for 1.0

- **The 0.x → 1.0 upgrade path is now documented** in the
  [Installation guide](https://docs.testplanit.com/docs/installation#upgrading):
  routine upgrades for Docker and source installs, and the **one-time baseline
  step** a database created by a 0.x release needs before its first v1.0 start
  (`zenstack migrate resolve --applied 20260625193632_init`), with commands
  for source checkouts and the official image. Databases that followed the
  beta channel have already done this step.

#### Dependencies

- **A final dependency refresh across every workspace** ahead of the cut — the
  app (Next.js 16.3.4, ZenStack 3.9.3, Tiptap 3.31, zod 4.5.4, React 19.2.8,
  the AWS SDK and Elasticsearch clients, and the rest of the minor/patch
  train), the reporter packages, the MCP server (`@modelcontextprotocol/sdk`
  1.30), the CLI, the Jira (Forge) app, and the docs site. Deliberately held
  majors (ESLint 10, TypeScript 7, undici 8, BullMQ 6) stay held.
- **A transitive override could float across majors.** The `markdown-it`
  version floor (`>=14.2.0`) resolved to the new 15.x, which its consumers
  declare no support for; the floor is now scoped to the 14.x line. Full test
  suites pass across all workspaces on the refreshed set.
