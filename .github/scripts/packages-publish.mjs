// Publish the Changesets-managed packages robustly.
//
// This is the `publish` command for the changesets action. It marks certain
// packages `private` at runtime so `pnpm changeset publish` skips them, then
// runs the publish. The mutations are runtime-only: this runs on the publish
// path (not the version-PR path) and the runner is ephemeral, so nothing is
// committed and the packages stay non-private everywhere else.
//
// Two things get skipped, both to avoid `@changesets/cli` crashing. When
// `changeset publish` tries to publish a version that is ALREADY on npm, the
// `pnpm publish` "already published" error is not handled by changesets'
// `isAlreadyPublishedError` (it reads `.includes` on `undefined` → throws), so
// the whole publish aborts:
//
//   1. @testplanit/cli — released by its own `cli-semantic-release.yml`
//      pipeline (via `@semantic-release/npm`, over OIDC) and always already on
//      npm. `changeset publish` ignores the changesets `ignore` list at publish
//      time, so it would otherwise try to republish cli and crash. We can't set
//      cli `private` permanently — that would also disable its real publisher.
//
//   2. Any package whose EXACT version is already published. changesets' own
//      "is it published?" detection is unreliable in this workspace (it reports
//      already-published versions as new — e.g. on a re-run after a partial
//      publish), so it re-attempts them and crashes. We check the registry
//      directly (`npm view <name>@<version>`), which is reliable, and skip the
//      ones that already exist. `changeset publish` then only ever attempts
//      genuinely-new versions.
//
// NOTE: the changesets action TOKENIZES the `publish` input (it does not run it
// through a shell), so the workflow must invoke this as a single command
// (`node .github/scripts/packages-publish.mjs`) — no multi-line blocks or shell
// operators.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function markPrivate(pkgPath, reason) {
  const pkg = readJson(pkgPath);
  if (pkg.private) return;
  pkg.private = true;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(
    `[packages-publish] excluding ${pkg.name}@${pkg.version} from changeset publish (${reason})`,
  );
}

// Direct registry check — reliable, unlike changesets' internal detection.
// `npm view <name>@<version> version` exits 0 and echoes the version when it is
// published, and exits non-zero (E404) when it is not.
function isPublished(name, version) {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === version;
}

// 1. Always exclude @testplanit/cli (released by cli-semantic-release.yml).
if (existsSync("cli/package.json")) {
  markPrivate("cli/package.json", "released by cli-semantic-release.yml");
}

// 2. Exclude any packages/* whose exact version is already on npm.
for (const entry of readdirSync("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgPath = `packages/${entry.name}/package.json`;
  if (!existsSync(pkgPath)) continue;
  const pkg = readJson(pkgPath);
  if (pkg.private || !pkg.name || !pkg.version) continue;
  if (isPublished(pkg.name, pkg.version)) {
    markPrivate(pkgPath, "already on npm");
  }
}

// Inherit stdio so `changeset publish`'s output still flows to the changesets
// action (it parses the published packages and tags from it).
const result = spawnSync("pnpm", ["changeset", "publish"], { stdio: "inherit" });
process.exit(result.status ?? 1);
