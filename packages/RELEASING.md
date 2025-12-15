# Releasing @testplanit/* Packages

This document describes how to release new versions of the TestPlanIt npm packages.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| `@testplanit/api` | Official API client for TestPlanIt | [![npm](https://img.shields.io/npm/v/@testplanit/api)](https://www.npmjs.com/package/@testplanit/api) |
| `@testplanit/wdio-reporter` | WebdriverIO reporter for TestPlanIt | [![npm](https://img.shields.io/npm/v/@testplanit/wdio-reporter)](https://www.npmjs.com/package/@testplanit/wdio-reporter) |

## Versioning

We use [Changesets](https://github.com/changesets/changesets) for version management. This provides:

- Semantic versioning based on change type
- Automatic changelog generation
- GitHub release creation
- npm publishing

## How to Release

### 1. Make Your Changes

Make your code changes to the packages in `packages/api` or `packages/wdio-testplanit-reporter`.

### 2. Create a Changeset

After making changes, create a changeset to document what changed:

```bash
pnpm changeset
```

This interactive command will ask you to:

1. **Select packages**: Choose which package(s) were changed
2. **Version bump type**: Select major, minor, or patch
3. **Summary**: Write a brief description of your changes

This creates a markdown file in `.changeset/` describing your changes.

### 3. Commit and Push

Commit your changes along with the changeset file:

```bash
git add .
git commit -m "feat(api): add new endpoint support"
git push
```

### 4. Open a Pull Request

Create a PR with your changes. The changeset file will be included.

### 5. Merge to Main

Once your PR is approved and merged, the GitHub Action will:

1. Detect the changeset
2. Create/update a "Version Packages" PR that:
   - Bumps version numbers in `package.json`
   - Updates `CHANGELOG.md` files
   - Removes the consumed changeset files

### 6. Release

When you're ready to release, merge the "Version Packages" PR. This will:

1. Update all version numbers
2. Publish packages to npm
3. Create GitHub releases with release notes

## Version Bump Guidelines

Choose the appropriate version bump based on your changes:

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking API changes | `major` | Removing a method, changing return types |
| New features | `minor` | Adding new methods, new options |
| Bug fixes | `patch` | Fixing a bug, updating dependencies |
| Documentation | `patch` | README updates, JSDoc improvements |

## Manual Commands

```bash
# Create a new changeset
pnpm changeset

# Check pending changesets
pnpm changeset status

# Preview what versions will be bumped
pnpm changeset version --dry-run

# Build all packages
pnpm --filter "@testplanit/*" build

# Run tests for all packages
pnpm --filter "@testplanit/*" test
```

## CI/CD

The release process is automated via GitHub Actions:

- **Trigger**: Push to `main` branch with changes in `packages/` or `.changeset/`
- **Workflow**: `.github/workflows/packages-release.yml`
- **Required Secrets**: `NPM_TOKEN` for npm publishing

## Troubleshooting

### "No changesets found"

If the workflow runs but doesn't find any changesets, make sure you created a changeset file using `pnpm changeset`.

### Build Failures

If the build fails, check that:
1. All TypeScript errors are resolved
2. Dependencies are correctly specified in `package.json`
3. The `@testplanit/api` package builds before `@testplanit/wdio-reporter` (it's a dependency)

### npm Publish Errors

If publishing fails:
1. Verify `NPM_TOKEN` secret is set in GitHub repository settings
2. Check that package names are available on npm
3. Ensure version numbers haven't already been published

## Local Development

To test packages locally before releasing:

```bash
# Build packages
pnpm --filter "@testplanit/api" build
pnpm --filter "@testplanit/wdio-reporter" build

# Link for local testing
cd packages/api && pnpm link --global
cd packages/wdio-testplanit-reporter && pnpm link --global

# In your test project
pnpm link --global @testplanit/api
pnpm link --global @testplanit/wdio-reporter
```
