---
title: Installation
sidebar_position: 2 # Keep position if desired for the category
---

# Installation

This section guides you through setting up TestPlanIt for local development.

Choose the method that best suits your environment:

- **[Manual Setup](manual-setup.md)**: Recommended if you prefer to manage Node.js, pnpm, and PostgreSQL directly on your host machine.
- **[Docker Setup (Development)](docker-setup.md)**: Recommended for a simpler, containerized setup where Docker manages the application and database environment.
- **[Kubernetes (Helm)](kubernetes-deployment.md)**: Deploy a self-hosted production instance to a Kubernetes cluster (EKS, GKE, AKS, or k3s) with the official Helm chart.

After completing a setup guide, proceed to the **[Getting Started](getting-started.md)** guide for a quick tour of the application.

## Upgrading

TestPlanIt applies database schema changes with versioned migrations (`zenstack migrate deploy`), which never drop data. Docker deployments apply pending migrations automatically when the container starts; source installs apply them with `pnpm db:deploy`.

A routine upgrade with Docker Compose, from the `testplanit/` directory. Use the
same `--profile` flags you started the stack with:

```bash
PROFILES="--profile with-postgres --profile with-valkey --profile with-elasticsearch --profile with-minio"
docker compose -f docker-compose.prod.yml $PROFILES pull
docker compose -f docker-compose.prod.yml $PROFILES up -d   # pending migrations apply on startup
```

The compose files use the `latest` release by default. To pin a version, set
`TESTPLANIT_VERSION` (for example `1.1.12`) in your shell, the default `.env`, or
`--env-file`, and change it when you want to upgrade.
The other variables the compose files read are listed under
[Docker Compose variables](environment-variables.md#docker-compose).

:::note Which image to use

Self-hosted deployments use **`testplanit-selfhost`**, which the compose files
and the Helm chart reference. It is domain-agnostic, so one image serves any
hostname, and it is published for both `linux/amd64` and `linux/arm64`. The
`testplanit` image is built for the hosted service, bakes its domain in at build
time, and is `arm64` only — pulling it on an x86 host fails with
`no matching manifest for linux/amd64`.

:::

A routine upgrade from source:

```bash
git pull origin main
pnpm install
pnpm generate
pnpm db:deploy   # apply pending migrations
pnpm build
```

### Upgrading to 1.3

**The Content Security Policy is now enforced.** 1.2 sent the policy in report-only mode, where the browser logged what it would have blocked and blocked nothing. From 1.3 the browser blocks anything the policy does not allow. A default install needs no change. After upgrading, check the following:

- **Something on a page stops loading.** Set `CSP_MODE=report-only` to restore the 1.2 behavior, find the blocked host in the `[csp] violation` lines of the application log, add its origin to `CSP_ALLOWED_ORIGINS`, then remove `CSP_MODE`.
- **Attachments on a previous storage host.** If the instance was ever moved to a different storage host and older attachments still point at the old one, their PDF, text and Office previews are replaced by a note that the file is stored on another host. Images and videos still display. Add the old host's origin to `CSP_ALLOWED_ORIGINS` to bring the previews back. See [Files on a previous storage host](file-storage.md#files-on-a-previous-storage-host).
- **TestPlanIt shown inside a frame on another site.** Only the app itself may frame its pages by default. List the sites that embed it in `CSP_FRAME_ANCESTORS`.

All three variables are described under [Content Security Policy](environment-variables.md#content-security-policy).

**`DATABASE_POOL_MAX` is now the limit for the whole application process.** Earlier releases opened three connection pools in each application process, so the process could hold up to three times `DATABASE_POOL_MAX` connections. From 1.3 it opens one. If queries start failing while waiting for a free connection after the upgrade, raise `DATABASE_POOL_MAX`, keeping the total across all processes under the server's `max_connections`.

### Upgrading from a pre-1.0 release

Databases created by a 0.x release predate versioned migrations and have no migration history, so the first v1.0 startup would try to re-create the baseline schema and fail. **Back up your database**, then record the baseline as already applied — once, before the first v1.0 start:

```bash
# From a source checkout:
cd testplanit
npx zenstack migrate resolve --applied 20260625193632_init --schema schema.zmodel
```

```bash
# Or with the official image (Compose users: substitute
# `docker compose run --rm --no-deps --entrypoint "" prod` for `docker run --rm --entrypoint ""`):
docker run --rm --entrypoint "" \
  -e DATABASE_URL="postgresql://user:password@host:5432/testplanit" \
  ghcr.io/testplanit/testplanit-selfhost:latest \
  npx zenstack migrate resolve --applied 20260625193632_init --schema schema.zmodel
```

The baseline matches the schema your database already has, so it is recorded without being run; the next startup applies the remaining migrations normally. A few notes:

- Use a **direct database connection** — migrations need a real session, not a transaction-mode pooler such as pgbouncer.
- Starting v1.0 against a pre-1.0 database **without** the baseline is safe: the startup `migrate deploy` fails and the app won't start, but nothing is changed. Run the baseline and start again.
- If you followed the 1.0 beta channel, you already did this step — nothing further is needed. Fresh installs need nothing special.

See the [migrations README](https://github.com/TestPlanIt/testplanit/blob/main/testplanit/migrations/README.md) for details.
