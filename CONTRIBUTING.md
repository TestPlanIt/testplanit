# Contributing to TestPlanIt

Thanks for your interest in contributing to TestPlanIt. This guide describes how the project works day to day: which branch your change belongs on, how to set up a development environment, what CI checks, and how your change gets released.

## Contents

- [Before you start](#before-you-start)
- [Ways to contribute](#ways-to-contribute)
- [Repository layout](#repository-layout)
- [Development setup](#development-setup)
- [Which branch to target](#which-branch-to-target)
- [Code conventions](#code-conventions)
- [Testing](#testing)
- [Commit messages and PR titles](#commit-messages-and-pr-titles)
- [Pull requests](#pull-requests)
- [How releases work](#how-releases-work)
- [Getting help](#getting-help)
- [Credit](#credit)

## Before you start

### Code of Conduct

Everyone taking part in this project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report unacceptable behavior to [conduct@testplanit.com](mailto:conduct@testplanit.com).

### Contributor License Agreement

TestPlanIt is dual-licensed: AGPL-3.0 for open-source use, and a commercial license for proprietary use (see [LICENSE.md](LICENSE.md)). The [Contributor License Agreement](https://testplanit.com/cla) grants the project the rights it needs to ship your contribution under both licenses.

When you open your first pull request, the CLA bot posts a comment with a link to the agreement and instructions for signing. A PR can't be merged until the CLA check passes. You only sign once, and the signature covers all your later PRs.

If you're contributing on behalf of your employer, email [cla@testplanit.com](mailto:cla@testplanit.com) before you open the PR.

### Security issues

Don't report vulnerabilities in public issues, discussions, or pull requests. Use [private vulnerability reporting](https://github.com/testplanit/testplanit/security/advisories/new) or email [security@testplanit.com](mailto:security@testplanit.com). See [SECURITY.md](SECURITY.md).

## Ways to contribute

### Report a bug

Search the [existing issues](https://github.com/testplanit/testplanit/issues) first. If there's no match, open a new one with the [bug report template](https://github.com/testplanit/testplanit/issues/new?template=bug_report.md). The most useful reports include:

- the TestPlanIt version (for a beta, the full tag, such as `v1.2.0-beta.7`)
- exact steps to reproduce
- what you expected and what happened instead
- browser console or server log output

### Suggest a feature

Open an issue with the [feature request template](https://github.com/testplanit/testplanit/issues/new?template=feature_request.md), or start a thread in [Discussions → Ideas](https://github.com/testplanit/testplanit/discussions/categories/ideas). Start with the problem you're trying to solve. We can work out the solution together.

### Write code

Issues labeled [`good first issue`](https://github.com/testplanit/testplanit/labels/good%20first%20issue) and [`help wanted`](https://github.com/testplanit/testplanit/labels/help%20wanted) are good places to start.

For anything bigger than a small fix, comment on the issue (or open one) **before you start** so we can agree on scope and on the [target branch](#which-branch-to-target). Features are expected to land complete. For example, a new issue-tracker integration should support the same capabilities as the existing ones (webhooks, custom fields, attachments, linked issues, milestone sync), not a subset. Agreeing on that up front saves you from reworking a finished PR.

### Improve the docs

The documentation site at [docs.testplanit.com](https://docs.testplanit.com) is built from [`docs/`](docs/) with Docusaurus. To preview it locally, run `pnpm --filter docs start` from the repository root. Docs should describe how the product works today. There's no need to explain why it was designed that way.

### Translate

UI strings come from `testplanit/messages/en-US.json`. All other locale files are produced by a Crowdin sync, so don't edit them in a PR: the next sync overwrites any changes. If you'd like to help with a language, ask in [Discord](https://discord.gg/kpfha4W2JH).

## Repository layout

The repository is a pnpm workspace with a single lockfile at its root.

| Path          | Contents                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `testplanit/` | The application: Next.js app and API routes, background workers, scheduler, data model, migrations, and tests             |
| `docs/`       | Documentation site (Docusaurus)                                                                                           |
| `packages/`   | npm packages: `@testplanit/api`, `@testplanit/mcp-server`, `@testplanit/playwright-reporter`, `@testplanit/wdio-reporter` |
| `cli/`        | The `@testplanit/cli` command-line tool                                                                                   |
| `forge-app/`  | The Jira app (Atlassian Forge)                                                                                            |

Inside `testplanit/`:

| Path            | Contents                                                                               |
| --------------- | -------------------------------------------------------------------------------------- |
| `schema.zmodel` | Data model and access-control rules. **This is the source of truth for the database.** |
| `migrations/`   | Versioned database migrations                                                          |
| `app/[locale]/` | Pages (App Router)                                                                     |
| `app/api/`      | API routes                                                                             |
| `app/actions/`  | Server actions                                                                         |
| `components/`   | React components; shadcn/ui primitives are in `components/ui/`                         |
| `hooks/`        | Custom React hooks                                                                     |
| `lib/`          | Services, integrations, and shared logic                                               |
| `zenstack/`     | Generated ZenStack client and schema (not committed)                                   |
| `workers/`      | BullMQ job processors                                                                  |
| `messages/`     | UI strings; `en-US.json` is the source                                                 |
| `e2e/`          | Playwright end-to-end tests                                                            |

## Development setup

### Prerequisites

- Node.js 24
- pnpm at the version pinned in the root `package.json`. Run `corepack enable` and Corepack installs the right version for you.
- Docker, to run PostgreSQL and Valkey
- About 8 GB of free memory for a production build (`pnpm build`). `pnpm install` and `pnpm dev` need much less.

### First-time setup

1. Fork the repository, clone your fork, and install dependencies from the repository root:

   ```bash
   git clone https://github.com/YOUR_USERNAME/testplanit.git
   cd testplanit
   corepack enable
   pnpm install
   ```

   `pnpm install` also generates the ZenStack client and the OpenAPI spec.

2. Create your environment file in the app directory:

   ```bash
   cd testplanit
   cp .env.example .env
   ln -s .env .env.development
   ```

   `pnpm dev`, the workers, and the scheduler read `.env`. `docker-compose.dev.yml` and the `*:dev` scripts read `.env.development`. The symlink keeps the two in sync.

   Edit `.env` and set at least these variables:

   | Variable                        | Local value                                                                                                                             |
   | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
   | `DATABASE_URL`                  | `postgresql://user:password@localhost:5432/testplanit_dev?schema=public`. This matches the Postgres container started in the next step. |
   | `NEXTAUTH_SECRET`               | The output of `openssl rand -base64 32`                                                                                                 |
   | `ENCRYPTION_KEY`                | The output of `openssl rand -hex 32`                                                                                                    |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The administrator account that the seed step creates                                                                                    |

   In `.env.example`, the two secrets are written as `$(openssl …)`. `.env` files don't run shell commands, so run each command yourself and paste the output into the file. The defaults for `NEXTAUTH_URL` (`http://localhost:3000`) and `VALKEY_URL` (`valkey://localhost:6379`) work as they are.

3. Start PostgreSQL and Valkey:

   ```bash
   docker compose -f docker-compose.dev.yml up -d postgres valkey
   ```

4. Set up the database. These commands apply the migrations, install the audit-log triggers, and seed an admin user and a demo project:

   ```bash
   pnpm exec dotenv -- pnpm db:deploy
   pnpm exec dotenv -- pnpm triggers:apply
   pnpm exec dotenv -- tsx db/seed.ts
   ```

   These scripts don't load `.env` themselves, so `dotenv --` passes it to them.

5. Start the app:

   ```bash
   pnpm dev
   ```

   Open <http://localhost:3000> and sign in with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

6. If your change touches anything that runs in the background (imports, notifications, search indexing, integration sync, CI webhooks, AI features), you'll also need the job workers. Run these in a second terminal:

   ```bash
   pnpm scheduler   # registers recurring jobs, then exits
   pnpm workers     # runs every worker and stays in the foreground
   ```

Elasticsearch (search) and S3-compatible storage (attachments, avatars, project icons) are optional. Without them the app still runs, but those features aren't available. To turn them on, point `ELASTICSEARCH_NODE` and the `AWS_*` variables at running instances. For details, see [Manual Setup](https://docs.testplanit.com/docs/manual-setup) and [Environment Variables](https://docs.testplanit.com/docs/environment-variables).

### Changing the data model

Edit `testplanit/schema.zmodel`. Never edit the generated output (`zenstack/` and the OpenAPI spec). Then regenerate and create a migration:

```bash
pnpm generate          # regenerate the ZenStack client and the OpenAPI spec
pnpm db:migrate:dev    # create and apply a migration against your dev database (prompts for a name)
```

Commit the new `migrations/<timestamp>_<name>/` directory together with your change. Production only runs `migrate deploy`, so a schema change without a migration never reaches it.

Before committing, review the generated SQL. Every generated migration includes a plain `CREATE INDEX "dcl_unprocessed_seq" …` statement that Prisma can't stop emitting, and it aborts the migration on a real database. Delete that statement. For more, see [`testplanit/migrations/README.md`](testplanit/migrations/README.md).

Access control lives in the schema as ZenStack `@@allow` / `@@deny` rules, not in route handlers.

## Which branch to target

| Change                                             | Base branch                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Bug fixes and small, self-contained improvements   | `main`                                                                                |
| New features and larger changes                    | The current release line: the newest `release/vX.Y` branch (currently `release/v1.2`) |
| Docs for behavior that's already on `main`         | `main`                                                                                |
| Docs for a feature that's only on the release line | The same `release/vX.Y` branch                                                        |

Maintainers port fixes from `main` to the release line, so you don't need to open two PRs. When a release line ships, it's merged into `main` wholesale. A feature PR opened against `main` while a release line is active usually has to be redone against the release line. If you're not sure where your change belongs, ask on the issue.

## Code conventions

Match the style of the code around your change. Beyond that:

- **Data access**: in components, use ZenStack's TanStack Query integration, `useClientQueries(schema).<model>.useFindMany(...)` (and `useCreate`, `useUpdate`, and so on), from `@zenstackhq/tanstack-query/react`, with `schema` from `~/zenstack/schema`. The access rules in `schema.zmodel` are enforced on those queries. Add a custom API route or server action only for logic that plain CRUD can't express, such as a transaction across several models, an external integration, or heavy aggregation.
- **Deleting data**: models with an `isDeleted` field are soft-deleted. Set `isDeleted: true` instead of deleting the row, and filter `isDeleted: false` in your queries.
- **Navigation**: import `Link`, `useRouter`, `redirect`, and similar helpers from `~/lib/navigation`, not from `next/link` or `next/navigation`. The wrapper keeps the user's locale in the URL.
- **Path aliases**: `~/` resolves to `testplanit/`, and `@/` resolves to `testplanit/app/`. Shortcuts such as `@/components/*` and `@/lib/*` are defined in `tsconfig.json`.
- **Components**: build from `components/ui/` and the existing shared components, such as `DataTable` and the user, project, and workflow-state display components. Don't re-create them.
- **Strings**: every user-facing string goes through `next-intl`, with a key in `messages/en-US.json`. Reuse an existing key whenever one fits. Error messages that server actions and API routes return stay in English.
- **Middleware**: Next.js 16 renamed `middleware.ts` to `proxy.ts`. The middleware is at `testplanit/proxy.ts`.

### Modal forms

Any modal that contains a form (create/edit/delete dialogs, wizards, etc.) must be conditionally mounted by its parent. The parent page owns the `open` state (and the row being edited/deleted, when applicable) and renders the trigger button inline; the modal file is a pure form component that takes `{ open, onClose }` as props.

**Add modal:**

```tsx
// parent page
const [addTagOpen, setAddTagOpen] = useState(false);

return (
  <>
    <Button onClick={() => setAddTagOpen(true)}>Add Tag</Button>
    {addTagOpen && (
      <AddTag open={addTagOpen} onClose={() => setAddTagOpen(false)} />
    )}
  </>
);
```

**Edit/Delete modal (row-driven):**

```tsx
// parent page
const [editingTag, setEditingTag] = useState<Tag | null>(null);
const [deletingTag, setDeletingTag] = useState<Tag | null>(null);

const columns = useMemo(
  () => getColumns(tCommon, setEditingTag, setDeletingTag),
  [tCommon]
);

return (
  <>
    <DataTable columns={columns} data={tags} />
    {editingTag && (
      <EditTag
        tag={editingTag}
        open={editingTag !== null}
        onClose={() => setEditingTag(null)}
      />
    )}
    {deletingTag && (
      <DeleteTag
        tag={deletingTag}
        open={deletingTag !== null}
        onClose={() => setDeletingTag(null)}
      />
    )}
  </>
);
```

The columns file accepts `onEditX` / `onDeleteX` callback props and wires them to plain Button `onClick` handlers — no `<DialogTrigger>` lives inside columns or modals.

The modal component must NOT:

- Hold its own `const [open, setOpen] = useState(false)` for the dialog state
- Include a `<DialogTrigger>`, `<AlertDialogTrigger>`, or the trigger button itself
- Rely on `useEffect` or imperative `reset()` calls to clear form state on close

**Why this matters:** If the modal holds its own `open` state, it stays mounted for the entire page lifetime, so `useForm` state and any local `useState` values persist across open/close cycles. This leaks form data — including sensitive fields like passwords, API keys, upload URLs, and editor content — into subsequent uses of the dialog. Conditional mounting makes React's unmount handle all cleanup automatically, so the bug is structurally impossible.

Reference implementations:

- Add: `app/[locale]/admin/tags/AddTag.tsx`, `app/[locale]/admin/groups/AddGroup.tsx`, `app/[locale]/admin/llm/AddLlmIntegration.tsx`
- Edit: `app/[locale]/admin/tags/EditTag.tsx`, `app/[locale]/admin/users/EditUser.tsx`, `app/[locale]/admin/llm/EditLlmIntegration.tsx`
- Delete: `app/[locale]/admin/tags/DeleteTag.tsx`, `app/[locale]/admin/users/DeleteUser.tsx`, `app/[locale]/admin/issues/DeleteIssue.tsx`

`pnpm check:modal-pattern` reports any file that matches the anti-pattern (`useForm` + local `[open, setOpen]` state + `DialogTrigger`). It isn't part of `pnpm lint`, so run it yourself when you refactor modals.

## Testing

### Before you push

From `testplanit/`, run:

```bash
pnpm precommit
```

This regenerates the OpenAPI spec, then runs ESLint, TypeScript type checking, the formatting check, the unit tests, and a docs build. It's a superset of what CI runs on your PR. If the formatting check fails, run `pnpm format` to fix it. It's the most common reason a PR goes red.

`pnpm precommit` doesn't cover `packages/*` or `cli/`. If you changed either, also run that package's own checks:

```bash
pnpm --filter @testplanit/api test run
pnpm --filter @testplanit/api typecheck
```

### Test types

- **Unit tests** (Vitest) sit next to the code they test, as `*.test.ts` or `*.test.tsx`. `pnpm test` starts watch mode, and `pnpm test run` runs the tests once.
- **Database integration tests** live in `__tests__/integration/` and run against a real PostgreSQL database. CI runs them on any PR that touches `lib/`, `db/`, or the schema.
- **End-to-end tests** (Playwright) live in `e2e/` and always run against a **production build**, never the dev server. They need their own services; for the one-time setup, see [E2E Testing](https://docs.testplanit.com/docs/e2e-testing). After setup:

  ```bash
  pnpm build
  E2E_PROD=on pnpm test:e2e                          # all specs
  E2E_PROD=on pnpm test:e2e e2e/tests/some.spec.ts   # a single spec
  ```

  When writing E2E tests, select elements by `data-testid` first, then by ARIA role or label, and by text only as a last resort. Check real routes in `app/[locale]/` instead of guessing URLs, and use unique test data (for example, `` `Tag ${Date.now()}` ``).

### What CI runs on your PR

| Check                                                                           | When it runs                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| CI: formatting, lint and type-check, unit tests, `packages/api` and `cli` tests | Every PR to `main` or `release/**`                                            |
| E2E smoke                                                                       | The PR touches `app/`, `components/`, `lib/`, `hooks/`, `e2e/`, or the schema |
| Accessibility smoke                                                             | The PR touches `app/`, `components/`, `styles/globals.css`, or `e2e/a11y/`    |
| DB integration                                                                  | The PR touches `lib/`, `db/`, `__tests__/integration/`, or the schema         |

For a first-time contributor, GitHub doesn't start the workflows on a PR from a fork until a maintainer approves them.

## Commit messages and PR titles

PRs are squash-merged. That makes your **PR title** the commit message on the target branch and the entry in the release notes, so the title must follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`. The individual commits on your branch can be anything.

| Type                                                        | Use it for                              | App release                        |
| ----------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| `fix`                                                       | Bug fixes                               | Patch                              |
| `enhancement`                                               | Improvements to an existing feature     | Patch, listed under "Enhancements" |
| `perf`                                                      | Performance improvements                | Patch                              |
| `feat`                                                      | New features, usually on a release line | Minor                              |
| `feat!:` or a `BREAKING CHANGE:` footer                     | Breaking changes                        | Major                              |
| `docs`, `test`, `refactor`, `style`, `ci`, `build`, `chore` | Everything else                         | None                               |

- **Scope** names the part of the product that changed, such as `runs`, `repository`, `reports`, `jira`, `i18n`, or `security`. The scopes `docs`, `packages`, `cli`, `forge-app`, `deps`, `dependencies`, and `release` never trigger an app release. The app is only released when files under `testplanit/` change.
- **Subject** is lowercase and imperative, and it describes what changes for users, not how the code changed. Some real examples:

  ```text
  fix(runs): fill summary bar segments to full width
  enhancement(app): tell open tabs when TestPlanIt was redeployed
  feat(repository): stage test cases privately and create them in a batch
  ```

Don't edit `CHANGELOG.md` or any `version` field. The release pipeline updates both.

## Pull requests

1. Open the PR against the [right branch](#which-branch-to-target), with a [Conventional Commits title](#commit-messages-and-pr-titles).
2. Fill in the PR template. Link the issue (`Closes #123`), and add screenshots for any UI change.
3. If you changed anything under `packages/`, add a changeset: run `pnpm changeset` from the repository root, choose the packages and the bump type, and commit the file it creates in `.changeset/`.
4. Sign the CLA when the bot asks.
5. Make sure CI passes.

### Review

- A maintainer reviews every PR. Expect questions and change requests, and push your fixes to the same branch.
- Sometimes a maintainer continues your work in a follow-up PR instead, for example to extend a fix to related screens or to bring a feature up to full scope. Your commits are carried into that PR, and you're credited there.
- When your change ships, the release bot comments on your PR with the version that includes it.

## How releases work

You don't need to do anything to get your change released. For reference, here's what happens after a merge:

- **Stable releases**: every merge to `main` that changes `testplanit/` runs [semantic-release](https://github.com/semantic-release/semantic-release). It chooses the version from the commit types, updates `CHANGELOG.md`, tags `vX.Y.Z`, publishes a GitHub release, and builds the Docker images.
- **Betas**: the current `release/vX.Y` branch is a semantic-release prerelease branch. Every merge there cuts `vX.Y.0-beta.N`, publishes a GitHub pre-release, and builds the self-host images. The images include a floating `:X.Y-beta` tag that always points to the newest beta. Nobody tags betas by hand.
- **Graduation**: when a release line is ready, it's merged into `main`, and that merge releases `vX.Y.0`.
- **npm packages** (`packages/*`): versioned with [Changesets](https://github.com/changesets/changesets). Merged changesets collect in a "Version Packages" PR, and merging that PR publishes to npm. Changes on the release line are published under the `beta` dist-tag.
- **CLI** (`cli/`): released separately by its own semantic-release, with `cli-vX.Y.Z` tags and binaries for Linux, macOS, and Windows.
- **Docs**: [docs.testplanit.com](https://docs.testplanit.com) redeploys whenever `docs/` changes on `main`.
- **Translations**: when `messages/en-US.json` changes on `main`, a workflow syncs it with Crowdin and commits the updated locale files.

## Getting help

- **Questions and ideas**: [GitHub Discussions](https://github.com/testplanit/testplanit/discussions)
- **Chat**: [Discord](https://discord.gg/kpfha4W2JH)
- **Documentation**: [docs.testplanit.com](https://docs.testplanit.com)
- **News**: [@testplanithq on X](https://x.com/testplanithq)
- **Email**: [support@testplanit.com](mailto:support@testplanit.com) for product support; [opensource@testplanit.com](mailto:opensource@testplanit.com) for questions about contributing
- **Security**: [security@testplanit.com](mailto:security@testplanit.com). See [SECURITY.md](SECURITY.md).

## Credit

Squash merges keep you as the author of the commit. The release notes link to your PR. If a maintainer continues your work in another PR, your commits go with it, and you're credited there too.

Thank you for helping make TestPlanIt better.
