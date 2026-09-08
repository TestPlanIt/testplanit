---
title: Build from Source
sidebar_position: 5
---

# Build from Source

TestPlanIt's prebuilt Docker images are built for the hosted service — they
bake `BASE_DOMAIN=testplanit.com` into the image, so they only work on that
domain. To run TestPlanIt on **your own** domain — and to try **beta /
pre-release** builds before an official release — you build the image yourself
from source. The compose files build from the `Dockerfile`, so this is a
one-command process.

## Trying a beta (pre-release)

Betas of upcoming releases are published as GitHub **pre-releases** and
distributed as **source only** (no image). To try one:

1. Open the [Releases page](https://github.com/TestPlanIt/testplanit/releases),
   find the latest entry marked **Pre-release** (e.g. `v1.0.0-beta.1`), and
   download its **Source code** archive — or check out the tag:
   ```bash
   git clone https://github.com/TestPlanIt/testplanit.git
   cd testplanit
   git checkout v1.0.0-beta.1
   ```
2. Follow [Build and run](#build-and-run) below.

> ⚠️ Pre-releases are not production-ready. **Always back up your database
> first** (see [Upgrading an existing database](#upgrading-an-existing-database)).

## Prerequisites

- Docker and the Docker Compose plugin
- A clone (or source archive) of the version you want to build

## Configure your environment

Copy the example env file and fill in your values:

```bash
cp testplanit/.env.example testplanit/.env.production
```

At minimum set `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and
`VALKEY_URL`. See [Installation](./installation.md) and
[Deployment](./deployment.md) for the full configuration reference.

## Build and run

The production compose file builds the image from the `Dockerfile` and starts
the full stack (app, workers, Postgres, Valkey, Elasticsearch, MinIO):

```bash
docker compose -f testplanit/docker-compose.prod.yml up -d --build
```

### Images and custom domains

How TestPlanIt serves uploaded images (project icons, avatars, attachments) is
fixed at **build time** by the `SELF_HOSTED` build argument. This is the single
most common self-hosting gotcha, so read this before your first build.

> ⚠️ `SELF_HOSTED` (and `BASE_DOMAIN` below) are **build-time** arguments. They
> are baked into the Next.js standalone build (`.next/required-server-files.json`)
> and the running server reads that frozen config. Setting them only at runtime
> in `.env.production` is **too late and silently has no effect** — the symptom
> is broken images that return `400` from `/_next/image`. They must reach
> `next build`, i.e. the `prod` service's `build.args` (already wired in the
> compose file). Compose fills those from your shell / default `.env` /
> `--env-file` — **not** from the `.env.production` `env_file`, which only injects
> runtime variables into the container.

**Default — `SELF_HOSTED=true` (recommended for self-hosting).** The compose file
defaults to this. Next.js's image optimizer is turned **off**, so `<Image>`
renders a plain `<img>` pointing straight at your storage. One build then works
on **any** domain with no allowlist to configure, and `BASE_DOMAIN` is ignored.
The default build needs nothing extra:

```bash
docker compose -f testplanit/docker-compose.prod.yml up -d --build
```

**Optional — `SELF_HOSTED=false` (Next.js image optimizer on).** Turn the
optimizer back on only if you want automatic image resizing/re-encoding. You must
then set `BASE_DOMAIN` to your real domain: it is baked into `next.config`'s image
`remotePatterns` allowlist so the optimizer accepts `*.your-domain` storage URLs.
Requests for any host outside the allowlist (including the `example.com` default)
return `400`.

```bash
SELF_HOSTED=false BASE_DOMAIN=example.com \
  docker compose -f testplanit/docker-compose.prod.yml up -d --build
```

Both are wired through the `prod` service's `build.args` in the compose file
(`SELF_HOSTED: ${SELF_HOSTED:-true}` and `BASE_DOMAIN: ${BASE_DOMAIN:-example.com}`).

## Upgrading an existing database

As of v1.0 TestPlanIt applies schema changes with **versioned migrations**
(`zenstack migrate deploy`), which the container runs automatically on startup.

A database created by an **older** TestPlanIt release has no migration history,
so the startup `migrate deploy` would try to re-create the baseline schema and
fail. **Back up your database, then run the one-time baseline before the first
v1.0 boot:**

```bash
cd testplanit
# Records the baseline as already-applied (it matches your existing schema) —
# it is NOT re-run. The container then applies the remaining migrations.
npx zenstack migrate resolve --applied 20260625193632_init --schema schema.zmodel
```

After this, every later upgrade is just a normal `migrate deploy` (handled by
the container). A **fresh** database needs nothing special — the entrypoint
applies all migrations in order. See
[`testplanit/migrations/README.md`](https://github.com/TestPlanIt/testplanit/blob/main/testplanit/migrations/README.md)
for details.

## Feedback

Hit a problem on a beta? [Open an issue](https://github.com/TestPlanIt/testplanit/issues/new)
and add the **beta** label so we can spot pre-release reports quickly.
