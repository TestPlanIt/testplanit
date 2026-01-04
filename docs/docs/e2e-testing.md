---
title: E2E Testing
sidebar_position: 15
---

# End-to-End Testing

This guide covers how to run and write end-to-end (E2E) tests for TestPlanIt using [Playwright](https://playwright.dev/).

## Prerequisites

- Node.js 20+ and pnpm installed
- PostgreSQL database available
- TestPlanIt development environment set up

## Setup

### 1. Create E2E Test Database

E2E tests require a **separate database** from your development database. This ensures tests run on clean, predictable data.

```bash
# Create a new PostgreSQL database for E2E tests
createdb testplanit_e2e

# Or via psql
psql -c "CREATE DATABASE testplanit_e2e;"
```

### 2. Configure Environment

From the `testplanit/` directory, copy the example environment file:

```bash
cd testplanit
cp .env.e2e.example .env.e2e
```

Edit `.env.e2e` and update the database connection:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/testplanit_e2e?schema=public"
```

The example file includes sensible defaults for:

- NextAuth configuration
- Valkey/Redis connection
- MinIO/S3 storage
- Default admin credentials for tests

### 3. Install Playwright Browsers

```bash
cd testplanit
pnpm exec playwright install
```

### 4. Setup the E2E Database

Run migrations and seed the E2E database with test data:

```bash
pnpm test:e2e:setup-db
```

## Running Tests

All E2E test commands are run from the `testplanit/` directory.

### Run All Tests

```bash
pnpm test:e2e
```

This will:

1. Load the `.env.e2e` environment
2. Start a development server on port 3002 (if not already running)
3. Run all Playwright tests

### Run with Production Build (Recommended)

For faster and more stable tests, use a production build:

```bash
pnpm test:e2e:prod
```

This builds the application first, then runs tests against the production build with more parallel workers.

### Complete Setup + Run

To set up the database and run tests in one command:

```bash
pnpm test:e2e:run
```

### Interactive UI Mode

Debug and explore tests visually:

```bash
pnpm test:e2e:ui
```

### Headed Mode

Watch the browser as tests execute:

```bash
pnpm test:e2e:headed
```

### Debug Mode

Step through tests with Playwright Inspector:

```bash
pnpm test:e2e:debug
```

### View Test Report

After running tests, view the HTML report:

```bash
pnpm test:e2e:report
```

## Test Configuration

The Playwright configuration is in `testplanit/e2e/playwright.config.ts`.

### Key Settings

| Setting | Value | Description |
| --------- | ------- |------------- |
| Port | 3002 | E2E tests run on port 3002 to avoid conflicts with dev server |
| Timeout | 60s | Global test timeout |
| Retries | 2 (CI only) | Tests retry on CI, not locally |
| Workers | 1 (dev) / 6 (prod) | More workers with production build |
| Browser | Chromium | Currently testing on Chrome only |

### Environment Variables

| Variable | Description |
| ---------- | ------------- |
| `E2E_PORT` | Override the default port (3002) |
| `E2E_BASE_URL` | Override the base URL for tests |
| `E2E_VIDEO` | Set to `on` to always record video |
| `E2E_PROD` | Set to `on` to run against production build |

## Project Structure

```text
testplanit/e2e/
├── playwright.config.ts     # Playwright configuration
├── global-setup.ts          # Authentication setup (runs once)
├── setup-db.ts              # Database seeding script
├── fixtures/
│   ├── index.ts             # Test fixtures
│   └── api.fixture.ts       # API helper for test data
├── page-objects/
│   ├── base.page.ts         # Base page object
│   ├── signin.page.ts       # Sign-in page
│   └── repository/
│       └── repository.page.ts
├── tests/
│   ├── auth/                # Authentication tests
│   └── repository/          # Repository feature tests
├── .auth/                   # Stored auth state (gitignored)
├── playwright-report/       # HTML reports (gitignored)
└── test-results/            # Test artifacts (gitignored)
```

## Writing Tests

### Adding New Test Files

Place new test files in the `tests/` directory, organized by feature:

```text
tests/
├── auth/                           # Authentication-related tests
│   └── auth.spec.ts
├── repository/                     # Repository feature tests
│   └── Test Repository Management/
│       ├── folder-creation.spec.ts
│       ├── test-case-management.spec.ts
│       └── ...
└── <new-feature>/                  # Add new feature directories as needed
    └── <test-name>.spec.ts
```

Test files must use the `.spec.ts` extension to be picked up by Playwright.

### Using Page Objects

```typescript
import { test, expect } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";

test("should create a folder", async ({ page }) => {
  const repositoryPage = new RepositoryPage(page);
  await repositoryPage.goto(1); // Project ID

  await repositoryPage.createFolder("My New Folder");
  await repositoryPage.verifyFolderExists("My New Folder");
});
```

### Using the API Fixture

Create test data via API for faster, more reliable tests:

```typescript
test("should display test cases", async ({ api, page }) => {
  // Create test data via API
  const folderId = await api.createFolder(1, "Test Folder");
  await api.createTestCase(1, folderId, "Test Case 1");

  // Navigate and verify
  const repositoryPage = new RepositoryPage(page);
  await repositoryPage.goto(1);
  await repositoryPage.selectFolder(folderId);
  await repositoryPage.verifyTestCaseExists("Test Case 1");

  // Cleanup is automatic via the api fixture
});
```

### Best Practices

1. **Use API for test data**: Create data via API instead of UI for speed and reliability
2. **Page Object Pattern**: Encapsulate page interactions in page objects
3. **Automatic cleanup**: The API fixture automatically cleans up created data after each test
4. **Isolated database**: Tests run against a separate database to avoid affecting development data

## Troubleshooting

### Authentication Issues

If tests fail with authentication errors:

```bash
rm -rf testplanit/e2e/.auth/
pnpm test:e2e
```

### Database Connection Issues

1. Ensure PostgreSQL is running
2. Verify `.env.e2e` has correct credentials
3. Re-run database setup: `pnpm test:e2e:setup-db`

### Port Conflicts

If port 3002 is in use:

```bash
E2E_PORT=3003 pnpm test:e2e
```

### Slow Tests

- Use `E2E_PROD=on` to run against production build
- Use API fixture to create test data instead of UI
- Use `test.only()` to run a single test during development

### Flaky Tests

- Check for timing issues and add proper waits
- Use `await expect(locator).toBeVisible()` instead of fixed delays
- Increase timeouts for slow operations
