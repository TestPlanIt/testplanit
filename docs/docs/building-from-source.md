---
title: Build from Source
sidebar_position: 5
---

# Build from Source

TestPlanIt publishes prebuilt `ghcr.io/testplanit/testplanit-selfhost` images
for `linux/amd64` and `linux/arm64`. They work on any domain, and the
[Helm chart](./kubernetes-deployment.md) uses them. The Docker Compose setup
(`docker-compose.prod.yml`) builds the image from the `Dockerfile` on your
machine instead, so building is a single command. Build from source when you
want to:

- run TestPlanIt with Docker Compose
- run a commit that hasn't been released yet
- run your own changes to TestPlanIt
- publish images to your own registry
- turn on the Next.js image optimizer (`SELF_HOSTED=false`), which is fixed at
  build time

## Trying a beta (pre-release)

Betas of the next release come from the current release branch
(`release/vX.Y`). Each one is published as a GitHub **pre-release**, such as
`v1.2.0-beta.7`, **and** as self-host images. With Helm or `docker run`, you
can pull a beta image instead of building it. A floating `X.Y-beta` tag always
points to the newest beta of that line:

```bash
docker pull ghcr.io/testplanit/testplanit-selfhost:1.2-beta           # server
docker pull ghcr.io/testplanit/testplanit-selfhost:1.2-beta-workers   # workers
```

To pin a specific beta, use its version as the tag instead, for example
`:1.2.0-beta.7` and `:1.2.0-beta.7-workers`. The
[Releases page](https://github.com/TestPlanIt/testplanit/releases) lists every
version; pre-releases are marked **Pre-release**.

With Docker Compose, or to build a beta yourself, check out its tag, then
follow [Build and run](#build-and-run):

```bash
git clone https://github.com/TestPlanIt/testplanit.git
cd testplanit
git checkout v1.2.0-beta.7
```

> ⚠️ Pre-releases are not production-ready. **Always back up your database
> before trying one.**

## Prerequisites

- Docker and the Docker Compose plugin
- A clone (or source archive) of the version you want to build
- About 8 GB of free memory for the build

## Configure your environment

Copy the example env file and fill in your values:

```bash
cp testplanit/.env.example testplanit/.env.production
```

At minimum, set `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
`VALKEY_URL`, and `ENCRYPTION_KEY`. See [Docker Setup](./docker-setup.md) and
[Environment Variables](./environment-variables.md) for the full configuration
reference.

## Build and run

The production compose file builds the image from the `Dockerfile` and starts
the stack. Each backing service is enabled with a profile; this command runs all
of them (Postgres, Valkey, Elasticsearch, and RustFS file storage):

```bash
docker compose -f testplanit/docker-compose.prod.yml \
  --profile with-postgres --profile with-valkey \
  --profile with-elasticsearch --profile with-minio \
  up -d --build
```

Leave out a profile to use your own instance of that service instead. See
[`DOCKER-PROFILES.md`](https://github.com/TestPlanIt/testplanit/blob/main/testplanit/DOCKER-PROFILES.md).

### Images and custom domains

How TestPlanIt serves uploaded images (project icons, avatars, attachments) is
fixed at **build time** by the `SELF_HOSTED` build argument.

> ⚠️ `SELF_HOSTED` (and `BASE_DOMAIN` below) are **build-time** arguments. They
> are baked into the Next.js standalone build (`.next/required-server-files.json`)
> and the running server reads that frozen config. Setting them only at runtime
> in `.env.production` is **too late and silently has no effect** — the symptom
> is broken images that return `400` from `/_next/image`. They must reach
> `next build`, i.e. the `prod` service's `build.args` (already wired in the
> compose file). Compose fills those from your shell / default `.env` /
> `--env-file` — **not** from the `.env.production` `env_file`, which only injects
> runtime variables into the container.

**Default: `SELF_HOSTED=true` (recommended).** The compose file defaults to
this setting, and the prebuilt `testplanit-selfhost` images are built with it. Next.js's image
optimizer is turned **off**, so `<Image>` renders a plain `<img>` that points
straight at your storage. One build then works on **any** domain with no
allowlist to configure, and `BASE_DOMAIN` is ignored.

**Optional: `SELF_HOSTED=false` (Next.js image optimizer on).** Turn the
optimizer back on only if you want automatic image resizing and re-encoding. You
must then set `BASE_DOMAIN` to your real domain. It's baked into `next.config`'s
image `remotePatterns` allowlist so the optimizer accepts `*.your-domain`
storage URLs. Requests for any host outside the allowlist (including the
`example.com` default) return `400`.

```bash
SELF_HOSTED=false BASE_DOMAIN=example.com \
  docker compose -f testplanit/docker-compose.prod.yml \
  --profile with-postgres --profile with-valkey \
  --profile with-elasticsearch --profile with-minio \
  up -d --build
```

Both are wired through the `prod` service's `build.args` in the compose file
(`SELF_HOSTED: ${SELF_HOSTED:-true}` and `BASE_DOMAIN: ${BASE_DOMAIN:-example.com}`).

## Upgrading an existing database

The container applies pending migrations (`zenstack migrate deploy`) every time
it starts, so upgrading is a rebuild and restart. A database created by a
**pre-1.0** release needs a one-time baseline first; see
[Upgrading from a pre-1.0 release](./installation.md#upgrading-from-a-pre-10-release).

## Feedback

Hit a problem on a beta? [Open an issue](https://github.com/TestPlanIt/testplanit/issues/new)
and put the exact beta version (for example, `v1.2.0-beta.7`) in the title.
