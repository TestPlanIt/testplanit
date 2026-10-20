# TestPlanIt

TestPlanIt is an open-source tool for creating, managing, and executing test plans. It supports manual and automated test cases. Easily manage test cases, record test results, and track test runs with TestPlanIt's flexible test case management.

Exploratory testing, session management & note-taking are first-class features in TestPlanIt's test management platform. Manage your test sessions and ad-hoc tests for fast release cycles and continuous delivery. All your test cases are managed in a central place and organized with folders, tags, and custom fields. Writing test cases has never been easier with fully customizable templates for all your projects.

This directory contains the TestPlanIt application: the Next.js app and API, the background workers and scheduler, the data model (`schema.zmodel`), database migrations, and the unit and end-to-end tests.

## Key Features

- Create, manage, and execute test plans.
- Support for both manual and automated test cases.
- Flexible test case management (folders, tags, custom fields).
- Test result recording and tracking.
- Exploratory testing session management and note-taking.
- Customizable test case templates.

## Local Development

### IMPORTANT: Package Manager Notice for AI Assistants

⚠️ **This project uses pnpm as its package manager. DO NOT use npm or yarn. Always use pnpm commands for installing dependencies and running scripts.**

### Quick Start

You need Node.js 24, pnpm (run `corepack enable` to get the pinned version), and Docker. From the repository root:

```bash
pnpm install
cd testplanit
cp .env.example .env            # then set DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY
ln -s .env .env.development
docker compose -f docker-compose.dev.yml up -d postgres valkey
pnpm exec dotenv -- pnpm db:deploy
pnpm exec dotenv -- pnpm triggers:apply
pnpm exec dotenv -- tsx db/seed.ts
pnpm dev
```

The app runs at [http://localhost:3000](http://localhost:3000). For an explanation of each step and the values to use, see [Development setup in CONTRIBUTING.md](../CONTRIBUTING.md#development-setup).

### Common Commands

```bash
pnpm dev              # Development server
pnpm workers          # All background workers (run `pnpm scheduler` first to register recurring jobs)
pnpm generate         # Regenerate the ZenStack client after editing schema.zmodel
pnpm db:migrate:dev   # Create and apply a migration against your dev database
pnpm test             # Unit tests (Vitest)
pnpm precommit        # Lint, type-check, format check, unit tests, and docs build
```

End-to-end tests run against a production build. See [E2E Testing](https://docs.testplanit.com/docs/e2e-testing).

## Deployment

- **[Installation](https://docs.testplanit.com/docs/installation)**: choose a deployment method and upgrade an existing install.
- **[Docker Setup](https://docs.testplanit.com/docs/docker-setup)**: run the full stack with Docker Compose (`docker-compose.prod.yml`), which builds the image on your machine.
- **[Kubernetes (Helm)](https://docs.testplanit.com/docs/kubernetes-deployment)**: deploy with the official Helm chart and the prebuilt `ghcr.io/testplanit/testplanit-selfhost` images.
- **[External Database Deployment](https://docs.testplanit.com/docs/external-database-deployment)**: use an existing PostgreSQL server.

## Technology Stack

- **Framework:** [Next.js](https://nextjs.org/) 16 (App Router), [React](https://react.dev/) 19
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) 4
- **UI Components:** [shadcn/ui](https://ui.shadcn.com/)
- **Data Model, ORM, and Access Control:** [ZenStack](https://zenstack.dev/) v3
- **Database:** [PostgreSQL](https://www.postgresql.org/)
- **Job Queue:** [BullMQ](https://bullmq.io/) on [Valkey](https://valkey.io/)
- **Search:** [Elasticsearch](https://www.elastic.co/elasticsearch/)
- **Rich Text Editing:** [Tiptap](https://tiptap.dev/)
- **Authentication:** [NextAuth.js](https://next-auth.js.org/)
- **Internationalization:** [next-intl](https://next-intl.dev/), with translations managed in Crowdin
- **Unit/Integration Testing:** [Vitest](https://vitest.dev/)
- **End-to-End Testing:** [Playwright](https://playwright.dev/)

## Contributing

Contributions are welcome. See the [Contributing Guide](../CONTRIBUTING.md).

## License

TestPlanIt is dual-licensed under AGPL-3.0 and a commercial license. See [LICENSE.md](../LICENSE.md).
