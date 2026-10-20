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

Pushing changes under `docs/` to `main` runs the **Docs Release** workflow (`.github/workflows/docs-release.yml`), which builds the site into a Docker image and publishes it. There's no manual deploy step.
