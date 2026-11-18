import { execFileSync } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  findProblem,
  isMergedIntoHead,
  releaseLineFor,
  verifyRelease,
} from "./semantic-release-guard.mjs";

const main = { name: "main" };
const release = (type: string, version: string) => ({ type, version });

describe("releaseLineFor", () => {
  it("maps a minor or major version to its release line", () => {
    expect(releaseLineFor("1.3.0")).toBe("release/v1.3");
    expect(releaseLineFor("2.0.0")).toBe("release/v2.0");
  });

  it("returns null for a patch version", () => {
    expect(releaseLineFor("1.2.1")).toBeNull();
  });
});

describe("findProblem", () => {
  const never = () => false;
  const always = () => true;

  it("allows a patch release on main", () => {
    expect(
      findProblem(
        { branch: main, nextRelease: release("patch", "1.2.1"), env: {} },
        never
      )
    ).toBeNull();
  });

  it("refuses a minor release on main when the release line is not merged", () => {
    const problem = findProblem(
      { branch: main, nextRelease: release("minor", "1.3.0"), env: {} },
      never
    );
    expect(problem).toContain("Refusing to release 1.3.0 from main");
    expect(problem).toContain("release/v1.3 is not merged into main");
  });

  it("refuses a major release on main when the release line is not merged", () => {
    expect(
      findProblem(
        { branch: main, nextRelease: release("major", "2.0.0"), env: {} },
        never
      )
    ).toContain("release/v2.0 is not merged into main");
  });

  it("asks about the release line that matches the next version", () => {
    const asked: string[] = [];
    findProblem(
      { branch: main, nextRelease: release("minor", "1.3.0"), env: {} },
      (branch) => {
        asked.push(branch);
        return false;
      }
    );
    expect(asked).toEqual(["release/v1.3"]);
  });

  it("allows a minor release on main once the release line is merged", () => {
    expect(
      findProblem(
        { branch: main, nextRelease: release("minor", "1.3.0"), env: {} },
        always
      )
    ).toBeNull();
  });

  it("allows a minor release on main with the explicit override", () => {
    expect(
      findProblem(
        {
          branch: main,
          nextRelease: release("minor", "1.3.0"),
          env: { ALLOW_MINOR_RELEASE: "true" },
        },
        never
      )
    ).toBeNull();
  });

  it("ignores an override value other than true", () => {
    expect(
      findProblem(
        {
          branch: main,
          nextRelease: release("minor", "1.3.0"),
          env: { ALLOW_MINOR_RELEASE: "false" },
        },
        never
      )
    ).not.toBeNull();
  });

  it("never blocks a prerelease branch", () => {
    expect(
      findProblem(
        {
          branch: { name: "release/v1.3", prerelease: "beta" },
          nextRelease: release("minor", "1.3.0-beta.3"),
          env: {},
        },
        never
      )
    ).toBeNull();
  });
});

describe("against a real repository", () => {
  // `origin` is a bare repo holding main and release/v1.3; the clone is where
  // the guard runs, like the CI checkout.
  function setUp() {
    const root = mkdtempSync(join(tmpdir(), "semantic-release-guard-"));
    const origin = join(root, "origin.git");
    const clone = join(root, "clone");
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd, stdio: "ignore" }
      );
    git(root, "init", "--bare", "--initial-branch=main", origin);
    git(root, "clone", origin, clone);
    git(clone, "commit", "--allow-empty", "-m", "fix: base");
    git(clone, "push", "origin", "HEAD:main");
    git(clone, "switch", "-c", "release/v1.3");
    git(clone, "commit", "--allow-empty", "-m", "feat: on the line");
    git(clone, "push", "origin", "release/v1.3");
    git(clone, "switch", "main");
    return { clone, git };
  }

  it("reports the line as unmerged while main does not contain it", async () => {
    const { clone, git } = setUp();
    git(clone, "commit", "--allow-empty", "-m", "feat: stray");

    expect(isMergedIntoHead("release/v1.3", clone)).toBe(false);
    await expect(
      verifyRelease(
        {},
        {
          branch: main,
          nextRelease: release("minor", "1.3.0"),
          env: {},
          cwd: clone,
        }
      )
    ).rejects.toThrow("Refusing to release 1.3.0 from main");
  });

  it("reports the line as merged after a merge commit, and lets the release through", async () => {
    const { clone, git } = setUp();
    git(clone, "merge", "--no-ff", "-m", "feat: graduate", "release/v1.3");

    expect(isMergedIntoHead("release/v1.3", clone)).toBe(true);
    await expect(
      verifyRelease(
        {},
        {
          branch: main,
          nextRelease: release("minor", "1.3.0"),
          env: {},
          cwd: clone,
        }
      )
    ).resolves.toBeUndefined();
  });

  it("reports a release line that does not exist as unmerged", () => {
    const { clone } = setUp();
    expect(isMergedIntoHead("release/v9.9", clone)).toBe(false);
  });
});
