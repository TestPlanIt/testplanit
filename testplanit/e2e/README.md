# E2E Tests for TestPlanIt

This directory contains Playwright end-to-end tests for TestPlanIt.

## Setup

### 1. Start the E2E Services

The E2E tests run against **separate services** from your development stack:
PostgreSQL, Valkey, Elasticsearch and MinIO (file storage). Start them with
Docker:

```bash
docker compose -f docker-compose.e2e.yml up -d
```

The ports (Postgres 5433, Valkey 6377, Elasticsearch 9221, MinIO 9100) don't
clash with `docker-compose.dev.yml`, so both stacks can run at once.

### 2. Configure Environment

Copy the example environment file. Its defaults match the services above:

```bash
cp .env.e2e.example .env.e2e
```

To use your own services instead, point `DATABASE_URL`, `VALKEY_URL`,
`ELASTICSEARCH_NODE` and the `AWS_*` storage settings at them. The database
is wiped on every run, so never point it at a database you want to keep.

### 3. Setup the E2E Database

Reset and seed the E2E database, and check that file storage is writable:

```bash
pnpm test:e2e:setup-db
```

`pnpm test:e2e` runs this automatically. Setup stops with an error if the
storage bucket is not writable with the configured credentials. With a local
MinIO it also creates the bucket and allows public reads.

### 4. Install Playwright Browsers

```bash
pnpm exec playwright install
```

## Running Tests

### Run all E2E tests

```bash
pnpm test:e2e
```

### Run tests with UI mode (interactive)

```bash
pnpm test:e2e:ui
```

### Run tests in headed mode (see the browser)

```bash
pnpm test:e2e:headed
```

### Debug a failing test

```bash
pnpm test:e2e:debug
```

### View the HTML report

```bash
pnpm test:e2e:report
```

## Project Structure

```monospace
e2e/
├── playwright.config.ts     # Playwright configuration
├── global-setup.ts          # Authentication setup (runs once before all tests)
├── fixtures/
│   ├── index.ts             # Test fixtures (api helper, etc.)
│   └── api.fixture.ts       # API helper for test data management
├── page-objects/
│   ├── base.page.ts         # Base page object with common methods
│   ├── signin.page.ts       # Sign-in page
│   └── repository/
│       └── repository.page.ts   # Repository page
├── tests/
│   └── smoke/
│       └── repository-smoke.spec.ts   # Smoke tests
├── .auth/                   # Stored authentication state (gitignored)
├── playwright-report/       # HTML test reports (gitignored)
└── test-results/           # Test artifacts (gitignored)
```

## Writing Tests

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

### Using the API Fixture for Test Data

```typescript
test("should display test cases", async ({ api, page }) => {
  // Create test data via API (faster and more reliable)
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

## Test Data Management

- **API Fixture**: Use `api.createFolder()` and `api.createTestCase()` to create test data
- **Automatic Cleanup**: The API fixture automatically deletes created data after each test
- **Database Isolation**: Tests run against a separate E2E database to avoid affecting development data

## Troubleshooting

### Authentication Issues

If tests fail with authentication errors:

1. Delete the auth state: `rm -rf e2e/.auth/`
2. Run tests again (will re-authenticate)

### Database Connection Issues

Ensure your E2E database is running and the `.env.e2e` file has correct credentials.

### Slow Tests

- Use API fixture to create test data instead of UI
- Run tests in parallel (default behavior)
- Use `test.only()` to run a single test during development
