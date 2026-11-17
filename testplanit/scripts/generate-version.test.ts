import { execFileSync } from "child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

const SHA = "cef294a6c0d1e2f3a4b5c6d7e8f90123456789ab";

// The script resolves package.json and its outputs relative to its own
// directory, so it runs in a copy outside the repo. PATH is emptied to make
// `git` unresolvable, which is the condition inside the image build: the root
// .dockerignore keeps .git out of the build context, so no stage can run
// `git rev-parse`.
function generateWithoutGit(env: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "generate-version-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(
    join(__dirname, "generate-version.js"),
    join(root, "scripts", "generate-version.js")
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "testplanit", version: "1.2.0" })
  );
  execFileSync(process.execPath, ["scripts/generate-version.js"], {
    cwd: root,
    env: { ...process.env, PATH: "", GIT_COMMIT: "", VERSION: "", ...env },
    stdio: "ignore",
  });
  return JSON.parse(
    readFileSync(join(root, "public", "version.json"), "utf-8")
  );
}

describe("generate-version without git", () => {
  it("records the commit and tag from the build args", () => {
    const info = generateWithoutGit({
      GIT_COMMIT: SHA,
      VERSION: "v1.2.0-beta.3",
    });
    expect(info.gitCommit).toBe(SHA.slice(0, 7));
    expect(info.gitTag).toBe("v1.2.0-beta.3");
    // The beta line is expressed only as a tag, so the tag is the app version.
    expect(info.version).toBe("1.2.0-beta.3");
    expect(info.isTaggedRelease).toBe(true);
  });

  it("ignores the bake default VERSION, which names no release", () => {
    const info = generateWithoutGit({ GIT_COMMIT: SHA, VERSION: "latest" });
    expect(info.gitCommit).toBe(SHA.slice(0, 7));
    expect(info.gitTag).toBe("");
    expect(info.version).toBe("1.2.0");
    expect(info.isTaggedRelease).toBe(false);
  });

  it("still reports unknown when nothing is passed", () => {
    expect(generateWithoutGit({}).gitCommit).toBe("unknown");
  });

  // Guards the plumbing the script depends on: build args reach it only if the
  // Dockerfile declares and exports them, and a published image is traceable
  // only if both final stages carry the revision label. Both were missing
  // before, which is how the images came to report "unknown".
  it("is wired to the Dockerfile's build args and provenance labels", () => {
    const dockerfile = readFileSync(
      join(__dirname, "..", "Dockerfile"),
      "utf-8"
    );
    expect(dockerfile).toMatch(/^ARG GIT_COMMIT$/m);
    expect(dockerfile).toMatch(/^ENV GIT_COMMIT=\$\{GIT_COMMIT\}$/m);
    expect(dockerfile).toMatch(/^ARG VERSION$/m);
    expect(dockerfile).toMatch(/^ENV VERSION=\$\{VERSION\}$/m);
    expect(
      dockerfile.match(
        /org\.opencontainers\.image\.revision="\$\{GIT_COMMIT\}"/g
      )
    ).toHaveLength(2);
  });
});
