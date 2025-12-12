# Changesets

This directory contains changesets for the `@testplanit/*` packages.

## What are Changesets?

Changesets are a way to manage versioning and changelogs for packages in this monorepo. When you make changes to a package, you create a changeset that describes what changed and what kind of version bump is needed.

## Packages Managed by Changesets

- `@testplanit/api` - API client for TestPlanIt
- `@testplanit/wdio-reporter` - WebdriverIO reporter for TestPlanIt

## How to Create a Changeset

After making changes to a package, run:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages have changed
2. Choose the type of version bump (major, minor, patch)
3. Write a summary of your changes

## Version Types

- **patch** (0.0.x): Bug fixes, documentation updates, dependency updates
- **minor** (0.x.0): New features that are backwards compatible
- **major** (x.0.0): Breaking changes

## Release Process

1. Make your changes and create a changeset
2. Open a PR with your changes and the changeset
3. When merged, a "Version Packages" PR will be automatically created
4. Merging the "Version Packages" PR will:
   - Update package versions
   - Update CHANGELOGs
   - Publish packages to npm

## Manual Commands

```bash
# Create a new changeset
pnpm changeset

# See what changes are pending
pnpm changeset status

# Bump versions based on changesets (CI does this)
pnpm changeset version

# Publish packages (CI does this)
pnpm changeset publish
```

## More Information

See the [Changesets documentation](https://github.com/changesets/changesets) for more details.
