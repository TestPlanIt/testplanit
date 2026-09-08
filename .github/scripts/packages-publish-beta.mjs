// Publish pre-release packages from the `beta` branch under the `beta` npm tag.
//
// The `beta` branch carries package changes that depend on the unreleased 1.0
// app and therefore cannot ship to `latest` — a user on the released app would
// install them and hit missing endpoints. They go out under the `beta` dist-tag
// instead, so `npm i @testplanit/mcp-server` keeps resolving to the `latest`
// release and testers opt in explicitly with `@beta`.
//
// Beta releases are NOT Changesets-managed. Changesets versions from `main`
// only (its "Version Packages" PR never lands on `beta`, which is why every
// packages/* version here trails npm). Cutting a beta is instead a deliberate
// manual step: set the package's version to an explicit pre-release on `beta`
// and push. Versions track the app's 1.0 beta line — `1.0.0-beta.N` — which is
// comfortably ahead of every packages/* `latest` (all still 0.x).
//
// That drives the safety gate below: this script publishes a package ONLY when
// its version contains a pre-release identifier. Every other packages/* on this
// branch carries a plain version that trails what is already on npm, so without
// the gate a push to `beta` would try to republish stale `latest` versions.
//
// This runs from packages-release.yml on purpose. npm trusted publishing (OIDC)
// authorizes ONE workflow filename per package, and that slot is spent on
// packages-release.yml — publishing from a new workflow file would fall back to
// anonymous auth and E404. See the workflow header.
import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TAG = "beta";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Direct registry check, matching packages-publish.mjs: `npm view <name>@<version>
// version` exits 0 and echoes the version when published, non-zero (E404) when
// not. Re-publishing an existing version is a hard error, so pushes to `beta`
// that don't bump the version must be a no-op.
function isPublished(name, version) {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === version;
}

const published = [];
const skipped = [];
const failedNames = new Set();
let failed = false;

const candidates = [];
for (const entry of readdirSync("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = `packages/${entry.name}`;
  const pkgPath = `${dir}/package.json`;
  if (!existsSync(pkgPath)) continue;
  const pkg = readJson(pkgPath);
  if (pkg.private || !pkg.name || !pkg.version) continue;
  candidates.push({ dir, pkg });
}

// Publish dependencies before dependents. The reporters depend on
// `@testplanit/api` as `workspace:^`, which pnpm rewrites at pack time to the
// api version being published in this same run — so api has to reach the
// registry first or the reporters land pointing at a version nobody can install
// yet. Filesystem order happens to put api first today; don't rely on it.
const names = new Set(candidates.map((c) => c.pkg.name));
const internalDeps = ({ pkg }) =>
  Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).filter((d) =>
    names.has(d)
  );
candidates.sort((a, b) => internalDeps(a).length - internalDeps(b).length);

for (const { dir, pkg } of candidates) {
  // The gate: no pre-release identifier, no beta publish.
  if (!pkg.version.includes("-")) {
    skipped.push(`${pkg.name}@${pkg.version} — not a pre-release version`);
    continue;
  }

  if (isPublished(pkg.name, pkg.version)) {
    skipped.push(`${pkg.name}@${pkg.version} — already on npm`);
    continue;
  }

  // Don't ship a package whose in-repo dependency just failed to publish — it
  // would resolve to a version that never reached the registry.
  const brokenDeps = internalDeps({ pkg }).filter((d) => failedNames.has(d));
  if (brokenDeps.length) {
    skipped.push(
      `${pkg.name}@${pkg.version} — dependency failed to publish: ${brokenDeps.join(", ")}`
    );
    failed = true;
    continue;
  }

  console.log(
    `[packages-publish-beta] publishing ${pkg.name}@${pkg.version} --tag ${TAG}`
  );
  // `--tag beta` overrides publishConfig.tag ("latest"), which stays correct for
  // the main-branch release path. `--no-git-checks` is required: pnpm otherwise
  // refuses to publish from a branch that isn't its default publish branch.
  const result = spawnSync(
    "pnpm",
    ["publish", "--tag", TAG, "--no-git-checks", "--access", "public"],
    { cwd: dir, stdio: "inherit" }
  );

  if (result.status === 0) {
    published.push(`${pkg.name}@${pkg.version}`);
  } else {
    failed = true;
    failedNames.add(pkg.name);
    console.error(
      `[packages-publish-beta] FAILED to publish ${pkg.name}@${pkg.version}`
    );
  }
}

const summary = [
  "## Beta Pre-releases",
  "",
  published.length
    ? `Published under the \`${TAG}\` tag (install with \`@${TAG}\`):\n\n${published
        .map((p) => `- ${p}`)
        .join("\n")}`
    : "No packages published.",
  ...(skipped.length
    ? [
        "",
        "<details><summary>Skipped</summary>",
        "",
        ...skipped.map((s) => `- ${s}`),
        "",
        "</details>",
      ]
    : []),
  "",
].join("\n");

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

process.exit(failed ? 1 : 0);
