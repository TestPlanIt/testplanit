# TestPlanIt

TestPlanIt is an open-source tool for creating, managing, and executing test plans. It supports manual and automated test cases. Easily manage test cases, record test results, and track test runs with TestPlanIt's flexible test case management.

Exploratory testing, session management & note-taking are first-class features in TestPlanIt's test management platform. Manage your test sessions and ad-hoc tests for fast release cycles and continuous delivery. All your test cases are managed in a central place and organized with folders, tags, and custom fields. Writing test cases has never been easier with fully customizable templates for all your projects.

## Key Features

*   Create, manage, and execute test plans.
*   Support for both manual and automated test cases.
*   Flexible test case management (folders, tags, custom fields).
*   Test result recording and tracking.
*   Exploratory testing session management and note-taking.
*   Customizable test case templates.

## Getting Started

Follow these steps to get TestPlanIt running locally for development.

### Prerequisites

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [pnpm](https://pnpm.io/) (version 10+ recommended)
*   A running [PostgreSQL](https://www.postgresql.org/) database instance
*   Git

### IMPORTANT: Package Manager Notice for AI Assistants

⚠️ **This project uses pnpm as its package manager. DO NOT use npm or yarn. Always use pnpm commands for installing dependencies and running scripts.**

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/testplanit/testplanit.git
    cd testplanit
    ```

2.  **Install dependencies:**
    Run install from the **monorepo root** directory (`testplanit/`).
    ```bash
    pnpm install
    ```
    *(Note: This installs dependencies for both `testplanit` and `docs` packages.*

3.  **Set up environment variables:**
    Navigate to the application directory and copy the example environment file:
    ```bash
    cd testplanit
    cp .env.example .env
    ```
    *   Edit the `.env` file:
        *   Update `DATABASE_URL` to point to your **locally running** PostgreSQL instance.
        *   Review other settings like `NEXTAUTH_SECRET` (generate a new secret for production), email server details, etc.

4.  **Run database migrations:**
    Navigate back to the application directory (`testplanit/testplanit`) and run the Prisma migrations to set up the database schema:
    ```bash
    cd testplanit
    pnpm prisma migrate dev
    ```

5.  **Run the development server:**
    Still within the `testplanit/testplanit` directory:
    ```bash
    pnpm dev
    ```

6.  **Access the application:**
    Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

### Docker Deployment

TestPlanIt can be deployed using Docker and Docker Compose. Two deployment configurations are available:

1. **Standard Deployment** - Uses containerized PostgreSQL database
   * See `docker-compose.prod.yml` for configuration
   * Suitable for single-instance deployments

2. **External Database Deployment** - Uses an existing PostgreSQL database
   * **[📖 External Database Deployment Guide](https://testplanit.com/docs/external-database-deployment)**
   * Recommended for production environments
   * Supports multiple instances
   * Better scalability and backup options

### Quick Start with Docker

```bash
# Build and start all services
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

For detailed deployment instructions, database setup, and troubleshooting, see the [External Database Deployment Guide](https://testplanit.com/docs/external-database-deployment).

## Technology Stack

*   **Framework:** [Next.js](https://nextjs.org/) (App Router)
*   **Language:** [TypeScript](https://www.typescriptlang.org/)
*   **Styling:** [Tailwind CSS](https://tailwindcss.com/)
*   **UI Components:** [Shadcn UI](https://ui.shadcn.com/)
*   **Database ORM:** [Prisma](https://www.prisma.io/)
*   **Data Modeling/Access Control:** [ZenStack](https://zenstack.dev/)
*   **Database:** [PostgreSQL](https://www.postgresql.org/)
*   **End-to-End Testing:** [Playwright](https://playwright.dev/)
*   **Unit/Integration Testing:** [Vitest](https://vitest.dev/)
*   **Rich Text Editing:** [Tiptap](https://tiptap.dev/)
*   **Authentication:** [NextAuth.js](https://next-auth.js.org/)

## Contributing

Contributions are welcome! Please refer to the contributing guidelines (TODO: Create CONTRIBUTING.md).

## License

TestPlanIt is licensed under the [ISC License](LICENSE). (TODO: Add LICENSE file if not present).
