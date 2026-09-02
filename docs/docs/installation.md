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

A routine upgrade with Docker:

```bash
docker pull ghcr.io/testplanit/testplanit:latest
docker compose up -d   # pending migrations apply on startup
```

A routine upgrade from source:

```bash
git pull origin main
pnpm install
pnpm generate
pnpm db:deploy   # apply pending migrations
pnpm build
```

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
  ghcr.io/testplanit/testplanit:latest \
  npx zenstack migrate resolve --applied 20260625193632_init --schema schema.zmodel
```

The baseline matches the schema your database already has, so it is recorded without being run; the next startup applies the remaining migrations normally. A few notes:

- Use a **direct database connection** — migrations need a real session, not a transaction-mode pooler such as pgbouncer.
- Starting v1.0 against a pre-1.0 database **without** the baseline is safe: the startup `migrate deploy` fails and the app won't start, but nothing is changed. Run the baseline and start again.
- If you followed the 1.0 beta channel, you already did this step — nothing further is needed. Fresh installs need nothing special.

See the [migrations README](https://github.com/TestPlanIt/testplanit/blob/main/testplanit/migrations/README.md) for details.
