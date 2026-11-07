# TestPlanIt Documentation

This directory is the source of the TestPlanIt documentation site, [docs.testplanit.com](https://docs.testplanit.com). It's built with [Docusaurus](https://docusaurus.io/) and is a member of the repository's pnpm workspace.

## Install

From the repository root:

```sh
pnpm install
```

## Local Development

```sh
pnpm --filter docs start
```

This starts a local development server and opens a browser window. Most changes appear without restarting the server.

## Build

```sh
pnpm --filter docs build
```

This generates the static site into `docs/build`. The app's `pnpm precommit` runs this build too, so broken links and MDX errors fail the local gate.

## Lint

```sh
pnpm --filter docs lint:md   # Markdown lint
pnpm --filter docs lint      # ESLint
```

## Deployment

Every release line is published as its own site, built from that line's branch or tag. The **Docs Release** workflow (`.github/workflows/docs-release.yml`) builds the site into a Docker image and publishes it:

| Ref            | Image tag   | Host                                                |
| -------------- | ----------- | --------------------------------------------------- |
| `main`         | `docs`      | `docs.testplanit.com` (the stable line)             |
| `release/vX.Y` | `docs-vX.Y` | `docs-vX-Y.testplanit.com` (the beta)               |
| tag `vX.Y.Z`   | `docs-vX.Y` | `docs-vX-Y.testplanit.com` (a frozen previous line) |

Pushing changes under `docs/` to `main` or a release branch runs the workflow automatically. Run it manually with a tag as `ref` to publish a previous line after its branch is gone. Hosts stay one level below `testplanit.com` because the zone's wildcard DNS record and universal TLS certificate cover only that level.

The build reads the release line from the `version` in `testplanit/package.json` (or the `DOCS_APP_VERSION` env var) and its own host from `DOCS_URL`. A prerelease version shows a beta banner. `DOCS_ALGOLIA_INDEX` selects the search index; each site needs its own index and crawler in the Algolia dashboard.

### Version picker

`static/versions.json` lists every hosted site. Each build bakes in its copy, and the navbar picker refreshes the list from the stable site's `/versions.json` on load, so a site built from an old tag still shows the lines that came after it. nginx serves that file with a permissive CORS header (`nginx/default.conf`).

When a release line graduates:

1. On `main`, before merging the release branch, note the last `vX.Y.Z` tag of the outgoing line.
2. Update `static/versions.json`: the new line becomes `stable` at `docs.testplanit.com`, the outgoing line becomes `previous` at its `docs-vX-Y` host, and any line no longer hosted is removed.
3. Run the workflow manually with the outgoing line's last tag as `ref` to publish its frozen site.
4. Point the graduated line's `docs-vX-Y` host at the stable site.

To run a one-off local build as another line:

```sh
DOCS_APP_VERSION=1.1.19 DOCS_URL=https://docs-v1-1.testplanit.com pnpm --filter docs build
```

`DOCS_VERSIONS_JSON` (inline JSON in the manifest format) replaces `static/versions.json` for a build, which lets a local preview point the picker at other local sites.
