---
title: Manual Setup
---

# Manual Installation Guide

This guide explains how to set up TestPlanIt for local development manually, without using Docker.

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v20.18.3 recommended)
- [pnpm](https://pnpm.io/) (version 10+ recommended)
- A running [PostgreSQL](https://www.postgresql.org/) database instance
- Git
- A running [Valkey](https://valkey.io/) instance (Redis-compatible, for background job processing)

:::warning Use Node v20.18.3
zenstack sometimes gives an error ```⨯ Error: Generated "enhance" function not found. Please run `zenstack generate` first.``` with some versions of node using turbopack. You can either use dev mode without turbopack or stick to a known good node version like v20.18.3.
:::

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

    - Edit the newly created `.env` file. The most crucial setting is `DATABASE_URL`. Update this value to point to your **locally running** PostgreSQL instance.
    - **Add the Valkey URL:** Add `VALKEY_URL="valkey://localhost:6379"` (or the appropriate URL if your Valkey instance is running elsewhere or requires authentication) to the file. This is needed for background job processing.
    - Review other settings like `NEXTAUTH_SECRET` (generate a new secret if needed), email server details (required for Magic Link authentication and notifications), etc., and configure them according to your needs.
    - **Admin User Seeding:** The `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` variables are used by the `pnpm prisma db seed` command to create the initial administrator user. You can customize these values in your `.env` file if you prefer different default credentials.

4. **Run database migrations:**
    Navigate back into the application directory (`testplanit/testplanit`) and run the Prisma migrations to create the necessary database tables:

    ```bash
    cd testplanit # Ensure you are in the testplanit/testplanit directory
    pnpm prisma migrate dev
    ```

5. **Run the development server:**
    Still within the `testplanit/testplanit` directory, start the Next.js development server:

    ```bash
    pnpm dev
    ```

6. **Access TestPlanIt:**
    Open your web browser and navigate to [http://localhost:3000](http://localhost:3000). You should see the TestPlanIt application.

You are now ready to start using TestPlanIt locally!
