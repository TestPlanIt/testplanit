// Publish the Changesets-managed packages, excluding @testplanit/cli.
//
// `pnpm changeset publish` publishes every non-private workspace package and
// does NOT honor the changesets `ignore` list at publish time, so it also tries
// to (re)publish @testplanit/cli — which is released by its own
// `cli-semantic-release.yml` pipeline and is already on npm. That redundant
// attempt fails and crashes `@changesets/cli`'s error handler, aborting the run
// before the real packages publish.
//
// Marking cli `"private": true` permanently would stop that, but it would also
// disable cli's real publisher (`@semantic-release/npm` skips private packages).
// So we mark cli private only here. This script is the `publish` command for the
// changesets action, which runs it ONLY on the publish path (not the version-PR
// path), and the runner is ephemeral — so the change is never committed.
// cli/package.json stays non-private everywhere else.
//
// NOTE: the changesets action tokenizes the `publish` input (it does not run it
// through a shell), so the workflow must invoke this as a single command
// (`node .github/scripts/packages-publish.mjs`) rather than an inline multi-line
// script.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const cliPkgPath = "cli/package.json";
const cliPkg = JSON.parse(readFileSync(cliPkgPath, "utf8"));
cliPkg.private = true;
writeFileSync(cliPkgPath, `${JSON.stringify(cliPkg, null, 2)}\n`);

// Inherit stdio so `changeset publish`'s output still flows to the changesets
// action (it parses the published packages and tags from it). Mirrors the
// original `pnpm changeset publish` invocation.
const result = spawnSync("pnpm", ["changeset", "publish"], { stdio: "inherit" });
process.exit(result.status ?? 1);
