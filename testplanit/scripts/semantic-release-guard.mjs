// semantic-release plugin: stop `main` from cutting a minor or major release
// that nobody asked for.
//
// semantic-release derives the version from every commit subject since the
// last tag and publishes at once. While a release line (`release/vX.Y`) is
// open, `main` is meant to cut patches only; a single `feat` commit reaching
// it would otherwise publish X.Y.0 from `main` ahead of the line.
//
// The rule, applied in the `verifyRelease` step (after the version is computed,
// before anything is tagged or published): a minor or major release X.Y.0 on a
// stable branch is allowed only when `origin/release/vX.Y` is fully merged into
// the commit being released, which is what a graduation is. Anything else
// fails the run. `ALLOW_MINOR_RELEASE=true` (the `allow_minor` input of the
// Semantic Release workflow) overrides the rule for a deliberate exception,
// such as a squash-merged graduation.
import { execFileSync } from "node:child_process";

/**
 * The release line a version graduates from, or null for a patch version.
 * @param {string} version
 * @returns {string | null}
 */
export function releaseLineFor(version) {
  const match = /^(\d+)\.(\d+)\.0$/.exec(version);
  return match ? `release/v${match[1]}.${match[2]}` : null;
}

/**
 * Whether `origin/<branch>` exists and is an ancestor of HEAD.
 * @param {string} branch
 * @param {string} cwd
 * @returns {boolean}
 */
export function isMergedIntoHead(branch, cwd) {
  const ref = `refs/remotes/origin/${branch}`;
  /** @param {string[]} args */
  const git = (args) => {
    try {
      execFileSync("git", args, { cwd, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  if (!git(["rev-parse", "--verify", "--quiet", ref])) {
    git(["fetch", "--quiet", "origin", `+refs/heads/${branch}:${ref}`]);
  }
  return git(["merge-base", "--is-ancestor", ref, "HEAD"]);
}

/**
 * @param {{
 *   branch: { name: string, prerelease?: string | boolean },
 *   nextRelease: { type: string, version: string },
 *   env: Record<string, string | undefined>,
 * }} context
 * @param {(branch: string) => boolean} isMerged
 * @returns {string | null} why the release must not go out, or null when it may
 */
export function findProblem({ branch, nextRelease, env }, isMerged) {
  if (branch.prerelease) return null;
  if (nextRelease.type !== "minor" && nextRelease.type !== "major") return null;
  if (env.ALLOW_MINOR_RELEASE === "true") return null;

  const line = releaseLineFor(nextRelease.version);
  if (line && isMerged(line)) return null;

  return [
    `Refusing to release ${nextRelease.version} from ${branch.name}: it is a ${nextRelease.type} release, and ${line ?? "its release line"} is not merged into ${branch.name}.`,
    `A commit that bumps the ${nextRelease.type} version (a \`feat\`, or a breaking change) reached ${branch.name} outside a graduation.`,
    `To cut a patch instead, remove or retype that commit. To release ${nextRelease.version} on purpose, run the Semantic Release workflow manually with "allow_minor" ticked.`,
  ].join("\n");
}

/**
 * @param {unknown} _pluginConfig
 * @param {{
 *   branch: { name: string, prerelease?: string | boolean },
 *   nextRelease: { type: string, version: string },
 *   env: Record<string, string | undefined>,
 *   cwd: string,
 * }} context
 */
export async function verifyRelease(_pluginConfig, context) {
  const problem = findProblem(context, (branch) =>
    isMergedIntoHead(branch, context.cwd)
  );
  if (problem) throw new Error(problem);
}
