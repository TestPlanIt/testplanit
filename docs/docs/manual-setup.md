---
title: Manual Setup
---

# Manual Installation Guide

This guide explains how to set up TestPlanIt for local development manually, without using Docker.

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) v24.x LTS
- [pnpm](https://pnpm.io/) v12 — the repository pins the exact version via the `packageManager` field in the root `package.json`, so the simplest setup is to run `corepack enable` (Corepack ships with Node.js) and let it provision the matching pnpm automatically
- Git

**System requirements:**

- **RAM:** about **2 GB free** for `pnpm install` (the ZenStack code-generation step peaks under 0.5 GB) and about **8 GB free** for a production `pnpm build` (the Next.js/Turbopack build peaks around 7 GB across its process tree). Lower-memory machines can add swap; the steps then complete more slowly instead of being killed. For production, the [Docker images](./docker-setup.md) remain the recommended path — the same build there also fits ~8 GB.

**Required Services:**

- **[PostgreSQL](https://www.postgresql.org/)** - Main database
- **[Valkey](https://valkey.io/)** or Redis - Job queue and caching (Redis-compatible)

**Optional Services:**

The application will run without these services, but certain features will be disabled:

- **[Elasticsearch](https://www.elastic.co/elasticsearch/)** - Search and indexing
  - *Without it:* Search functionality will be unavailable, but the application will function normally otherwise
- **[RustFS](https://github.com/rustfs/rustfs)**, AWS S3, or another S3-compatible service - File storage for attachments
  - *Without it:* File uploads (attachments, avatars, project icons) will fail with an error message
- **SMTP Email Server** - Email notifications and Magic Link authentication
  - *Without it:* In-app notifications will still work, but email delivery will fail; Magic Link authentication will be unavailable (use password authentication instead)

## Installation & Setup Steps

1. **Clone the repository:**
    Open your terminal and clone the TestPlanIt monorepo:

    ```bash
    git clone https://github.com/testplanit/testplanit.git
    cd testplanit
    ```

2. **Install dependencies:**
    Run the installation command from the **monorepo root** directory (`testplanit/`):

    ```bash
    pnpm install
    ```

    This installs dependencies for all packages in the monorepo.

3. **Set up environment variables:**
    Navigate into the TestPlanIt application directory (`testplanit/testplanit`) and copy the example environment file:

    ```bash
    cd testplanit
    cp .env.example .env
    ```

    Edit the newly created `.env` file:

    - **`DATABASE_URL`**: point it at your **locally running** PostgreSQL instance, for example `postgresql://user:password@localhost:5432/testplanit?schema=public`. The example file uses the Docker service hostname `postgres`, which only resolves inside Docker.
    - **`VALKEY_URL`**: the default, `valkey://localhost:6379`, works for a local Valkey or Redis. Change it if your instance runs elsewhere or requires authentication.
    - **`NEXTAUTH_SECRET`** and **`ENCRYPTION_KEY`**: generate them with `openssl rand -base64 32` and `openssl rand -hex 32` and paste the output in. The example file shows these as `$(openssl …)`, but `.env` files don't run shell commands.
    - **Email server settings**: required for Magic Link authentication and notification emails.
    - **Admin user**: the seed step below creates the initial administrator from `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD`. Change them if you want different credentials.

4. **Set up the database:**
    From the `testplanit/testplanit` directory, apply the migrations, install the audit-log triggers, and seed the database:

    ```bash
    pnpm exec dotenv -- pnpm db:deploy
    pnpm exec dotenv -- pnpm triggers:apply
    pnpm exec dotenv -- tsx db/seed.ts
    ```

    These scripts don't read `.env` on their own, so `dotenv --` passes it to them.

    Besides the administrator, the seed creates a **Demo Project** with sample test cases, test runs, sessions, milestones, tags, and issues, so you can explore TestPlanIt right away. You can delete the Demo Project at any time from Administration > Projects.

5. **Run the development server:**
    Still within the `testplanit/testplanit` directory, start the Next.js development server:

    ```bash
    pnpm dev
    ```

6. **Start the background workers:**
    Notifications, email, imports, search indexing, integration sync, and AI features run in background workers. In a second terminal, from the same directory:

    ```bash
    pnpm scheduler   # registers recurring jobs, then exits
    pnpm workers     # runs all workers
    ```

    See [Background Processes](./background-processes.md) for what each worker does.

7. **Access TestPlanIt:**
    Open your web browser and navigate to [http://localhost:3000](http://localhost:3000), then sign in with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

You are now ready to start using TestPlanIt locally!
