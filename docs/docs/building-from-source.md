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

### Custom domain (optional)

`BASE_DOMAIN` is a **build-time** argument that enables Next.js image
optimization for a wildcard domain — it's only needed if you serve multiple
subdomains (`a.example.com`, `b.example.com`, …) from a single image. A
single-domain install does not need it. To set it, build with:

```bash
docker build --build-arg BASE_DOMAIN=example.com \
  --target production -f testplanit/Dockerfile -t testplanit:local .
```

(or add `args: { BASE_DOMAIN: "${BASE_DOMAIN}" }` under the `prod` service's
`build:` block in the compose file).

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
