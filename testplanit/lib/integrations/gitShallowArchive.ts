import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ShallowArchiveRequest {
  /** HTTPS clone URL, without credentials. */
  url: string;
  /** Branch, tag or commit to fetch. */
  ref: string;
  /** Value of the Authorization header, e.g. `Basic …`. */
  authorization: string;
  timeoutMs: number;
}

function git(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { env, timeout: timeoutMs },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        reject(Object.assign(err, { stderr: String(stderr ?? "") }));
      }
    );
  });
}

/**
 * Git reports an HTTP failure as text. Map it onto the messages the HTTP
 * adapters throw, so callers classify a clone failure the same way they
 * classify a failed request.
 */
function toAdapterError(err: any, ref: string, timeoutMs: number): Error {
  const stderr: string = err?.stderr ?? "";
  if (err?.killed) {
    return new Error(`git fetch timed out after ${timeoutMs / 1000}s`);
  }
  if (/returned error: 429/.test(stderr)) {
    return new Error("Rate limit exceeded.");
  }
  // A rejected credential makes Git ask for another one; with prompts off,
  // that request is the only trace of the 401.
  if (
    /Authentication failed|returned error: 401|could not read (Username|Password)/.test(
      stderr
    )
  ) {
    return new Error("HTTP 401 Unauthorized");
  }
  if (/returned error: 403/.test(stderr)) {
    return new Error("HTTP 403 Forbidden");
  }
  if (/couldn't find remote ref|not our ref/.test(stderr)) {
    return new Error(`HTTP 404 Not Found: no ref "${ref}" in the repository`);
  }
  if (/returned error: 404|not found/i.test(stderr)) {
    return new Error("HTTP 404 Not Found");
  }
  const reason = stderr.trim().split("\n").at(-1) ?? "";
  return new Error(`git fetch failed: ${reason.slice(0, 200)}`);
}

/**
 * Fetch one commit of a repository over Git's HTTPS protocol and return its
 * tree as a zip, with paths relative to the repository root. One shallow
 * fetch replaces thousands of per-file API requests and is not subject to the
 * provider's API quota or its archive-download size cap.
 *
 * The credential travels in the environment, never in the URL or the argument
 * list, so it does not appear in the process table or in Git's error output.
 *
 * @returns null when no `git` binary is installed
 */
export async function gitShallowArchive(
  request: ShallowArchiveRequest
): Promise<Buffer | null> {
  const { url, ref, authorization, timeoutMs } = request;
  if (!ref || ref.startsWith("-")) {
    throw new Error(`Invalid ref "${ref}"`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: "https",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: ${authorization}`,
    GIT_CONFIG_KEY_1: "http.followRedirects",
    GIT_CONFIG_VALUE_1: "false",
  };

  const workDir = await mkdtemp(join(tmpdir(), "repo-archive-"));
  const repoDir = join(workDir, "repo.git");
  const zipPath = join(workDir, "tree.zip");
  try {
    await git(["init", "--bare", "--quiet", repoDir], env, timeoutMs);
    await git(
      [
        "-C",
        repoDir,
        "fetch",
        "--quiet",
        "--depth",
        "1",
        "--no-tags",
        url,
        ref,
      ],
      env,
      timeoutMs
    );
    await git(
      ["-C", repoDir, "archive", "--format=zip", "-o", zipPath, "FETCH_HEAD"],
      env,
      timeoutMs
    );
    return await readFile(zipPath);
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw toAdapterError(err, ref, timeoutMs);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
