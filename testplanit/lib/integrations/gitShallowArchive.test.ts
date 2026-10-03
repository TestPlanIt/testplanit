import { existsSync, writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFile = vi.fn();
vi.mock("node:child_process", () => {
  const execFile = (...args: unknown[]) => mockExecFile(...args);
  return { execFile, default: { execFile } };
});

import { gitDefaultBranch, gitShallowArchive } from "./gitShallowArchive";

type Call = { args: string[]; env: NodeJS.ProcessEnv; timeout: number };

/** Git that succeeds, writing `zip` where `archive -o` points. */
function gitSucceeds(zip = "zip-bytes"): Call[] {
  const calls: Call[] = [];
  mockExecFile.mockImplementation((_cmd, args: string[], opts, done) => {
    calls.push({ args, env: opts.env, timeout: opts.timeout });
    if (args.includes("archive")) {
      writeFileSync(args[args.indexOf("-o") + 1], zip);
    }
    done(null, "", "");
  });
  return calls;
}

/** Git whose fetch fails with `stderr`. */
function fetchFails(stderr: string, extra: Record<string, unknown> = {}) {
  mockExecFile.mockImplementation((_cmd, args: string[], _opts, done) => {
    if (args.includes("fetch")) {
      return done(Object.assign(new Error("exit 128"), extra), "", stderr);
    }
    done(null, "", "");
  });
}

const request = {
  url: "https://bitbucket.org/ws/repo.git",
  ref: "main",
  authorization: "Basic c2VjcmV0",
  timeoutMs: 5000,
};

describe("gitShallowArchive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches one commit and returns its tree as a zip", async () => {
    const calls = gitSucceeds("zip-bytes");

    const zip = await gitShallowArchive(request);

    expect(zip?.toString()).toBe("zip-bytes");
    const repoDir = calls[0].args.at(-1)!;
    expect(calls.map((c) => c.args)).toEqual([
      ["init", "--bare", "--quiet", repoDir],
      [
        "-C",
        repoDir,
        "fetch",
        "--quiet",
        "--depth",
        "1",
        "--no-tags",
        "https://bitbucket.org/ws/repo.git",
        "main",
      ],
      [
        "-C",
        repoDir,
        "archive",
        "--format=zip",
        "-o",
        expect.stringMatching(/tree\.zip$/),
        "FETCH_HEAD",
      ],
    ]);
    expect(calls.every((c) => c.timeout === 5000)).toBe(true);
    // Nothing is left on disk.
    expect(existsSync(repoDir)).toBe(false);
  });

  it("passes the credential in the environment, never in the arguments", async () => {
    const calls = gitSucceeds();

    await gitShallowArchive(request);

    const fetch = calls[1];
    expect(fetch.args.join(" ")).not.toContain("c2VjcmV0");
    expect(fetch.env).toMatchObject({
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: "Authorization: Basic c2VjcmV0",
      GIT_CONFIG_KEY_1: "http.followRedirects",
      GIT_CONFIG_VALUE_1: "false",
      GIT_ALLOW_PROTOCOL: "https",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
    });
  });

  it("returns null when git is not installed", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, done) =>
      done(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }))
    );

    expect(await gitShallowArchive(request)).toBeNull();
  });

  it.each([
    [
      "fatal: unable to access 'https://bitbucket.org/ws/repo.git/': The requested URL returned error: 403",
      "HTTP 403 Forbidden",
    ],
    [
      "fatal: Authentication failed for 'https://bitbucket.org/ws/repo.git/'",
      "HTTP 401 Unauthorized",
    ],
    [
      "fatal: could not read Username for 'https://bitbucket.org': terminal prompts disabled",
      "HTTP 401 Unauthorized",
    ],
    [
      "fatal: unable to access 'https://bitbucket.org/ws/repo.git/': The requested URL returned error: 429",
      "Rate limit exceeded.",
    ],
    [
      "fatal: couldn't find remote ref main",
      'HTTP 404 Not Found: no ref "main" in the repository',
    ],
    [
      "fatal: repository 'https://bitbucket.org/ws/repo.git/' not found",
      "HTTP 404 Not Found",
    ],
    [
      "error: RPC failed\nfatal: early EOF",
      "git fetch failed: fatal: early EOF",
    ],
  ])("reports %s as an adapter error", async (stderr, message) => {
    fetchFails(stderr);

    await expect(gitShallowArchive(request)).rejects.toThrow(
      new Error(message)
    );
  });

  it("reports a fetch that ran out of time", async () => {
    fetchFails("", { killed: true });

    await expect(gitShallowArchive(request)).rejects.toThrow(
      "git fetch timed out after 5s"
    );
  });

  it("removes its working directory when the fetch fails", async () => {
    let repoDir = "";
    mockExecFile.mockImplementation((_cmd, args: string[], _opts, done) => {
      if (args[0] === "init") repoDir = args.at(-1)!;
      if (args.includes("fetch"))
        return done(new Error("exit 128"), "", "boom");
      done(null, "", "");
    });

    await expect(gitShallowArchive(request)).rejects.toThrow();
    expect(repoDir).not.toBe("");
    expect(existsSync(repoDir)).toBe(false);
  });

  it("refuses a ref that git would read as an option", async () => {
    await expect(
      gitShallowArchive({ ...request, ref: "--upload-pack=evil" })
    ).rejects.toThrow('Invalid ref "--upload-pack=evil"');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe("gitDefaultBranch", () => {
  const { url, authorization, timeoutMs } = request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the branch the remote's HEAD points at", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, done) =>
      done(null, "ref: refs/heads/release/2.x\tHEAD\n3f1c9d2\tHEAD\n", "")
    );

    expect(await gitDefaultBranch({ url, authorization, timeoutMs })).toBe(
      "release/2.x"
    );
    const [, args, opts] = mockExecFile.mock.calls[0];
    expect(args).toEqual(["ls-remote", "--symref", url, "HEAD"]);
    expect(opts.env.GIT_CONFIG_VALUE_0).toBe("Authorization: Basic c2VjcmV0");
  });

  it("returns null when the remote's HEAD names no branch", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, done) =>
      done(null, "3f1c9d2\tHEAD\n", "")
    );

    expect(
      await gitDefaultBranch({ url, authorization, timeoutMs })
    ).toBeNull();
  });

  it("returns null when git is not installed", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, done) =>
      done(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }))
    );

    expect(
      await gitDefaultBranch({ url, authorization, timeoutMs })
    ).toBeNull();
  });

  it("reports a rejected token as an adapter error", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, done) =>
      done(
        new Error("exit 128"),
        "",
        "fatal: could not read Username for 'https://bitbucket.org': terminal prompts disabled"
      )
    );

    await expect(
      gitDefaultBranch({ url, authorization, timeoutMs })
    ).rejects.toThrow("HTTP 401 Unauthorized");
  });
});
