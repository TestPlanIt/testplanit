import { describe, expect, it } from "vitest";
import type {
  ChangedFile,
  CompareResult,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { readImpactConfig } from "./config";
import {
  buildDiffSummary,
  classifyPath,
  extractChangedSymbols,
  renderDiffSummaryForPrompt,
} from "./diffSummary";
import type { DiffFileClass, DiffFileSummary, DiffSummary } from "./types";

const cfg = readImpactConfig({});

function changed(
  path: string,
  overrides: Partial<ChangedFile> = {}
): ChangedFile {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 1,
    isBinary: false,
    ...overrides,
  };
}

function compare(
  files: ChangedFile[],
  overrides: Partial<CompareResult> = {}
): CompareResult {
  return {
    baseSha: "base",
    headSha: "head",
    files,
    commits: [],
    truncated: false,
    ...overrides,
  };
}

function hunk(
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
  context: string,
  body: string[]
): string {
  const header = `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
  return [context ? `${header} ${context}` : header, ...body].join("\n");
}

describe("classifyPath", () => {
  const table: Array<[string, boolean, DiffFileClass]> = [
    ["image.png", true, "binary"],
    ["package-lock.json", true, "binary"],
    ["package-lock.json", false, "lockfile"],
    ["pnpm-lock.yaml", false, "lockfile"],
    ["yarn.lock", false, "lockfile"],
    ["Cargo.lock", false, "lockfile"],
    ["poetry.lock", false, "lockfile"],
    ["go.sum", false, "lockfile"],
    ["Gemfile.lock", false, "lockfile"],
    ["composer.lock", false, "lockfile"],
    ["packages/web/yarn.lock", false, "lockfile"],
    ["public/js/app.min.js", false, "minified"],
    ["styles/site.min.css", false, "minified"],
    ["vendor/lib.go", false, "vendored"],
    ["node_modules/x/index.js", false, "vendored"],
    ["third_party/y.c", false, "vendored"],
    [".yarn/releases/yarn.cjs", false, "vendored"],
    ["packages/a/node_modules/b.js", false, "vendored"],
    ["src/__generated__/schema.ts", false, "generated"],
    ["src/api.generated.ts", false, "generated"],
    ["proto/x.pb.go", false, "generated"],
    ["lib/models.g.dart", false, "generated"],
    ["src/__tests__/__snapshots__/x.test.ts.snap", false, "generated"],
    ["dist/index.js", false, "generated"],
    ["build/out.js", false, "generated"],
    ["out/x.js", false, "generated"],
    ["packages/a/dist/x.js", false, "generated"],
    ["src/login.test.ts", false, "test"],
    ["src/login.spec.tsx", false, "test"],
    ["src/__tests__/login.ts", false, "test"],
    ["tests/e2e/login.ts", false, "test"],
    ["src/test/fixtures.ts", false, "test"],
    ["pkg/server_test.go", false, "test"],
    ["spec/models/user_spec.rb", false, "test"],
    ["README.md", false, "docs"],
    ["docs/guide.mdx", false, "docs"],
    ["CHANGES.rst", false, "docs"],
    ["notes.txt", false, "docs"],
    ["package.json", false, "config"],
    ["config.yaml", false, "config"],
    [".github/workflows/ci.yml", false, "config"],
    ["pyproject.toml", false, "config"],
    ["setup.ini", false, "config"],
    [".env.local", false, "config"],
    [".eslintrc", false, "config"],
    ["packages/a/.prettierrc", false, "config"],
    ["src/auth/login.ts", false, "source"],
    ["lib/x.py", false, "source"],
    ["main.go", false, "source"],
    ["Dockerfile", false, "source"],
  ];

  it.each(table)("%s (binary=%s) → %s", (path, isBinary, expected) => {
    expect(classifyPath(path, isBinary)).toBe(expected);
  });
});

describe("extractChangedSymbols", () => {
  it("reads the hunk header context and +/- declaration lines", () => {
    const patch = [
      "@@ -1,5 +1,6 @@ export function validatePassword(pw: string) {",
      " import x;",
      "+export class LoginForm extends Component {",
      "+  def login_user(self):",
      "-func Start() {",
      "+interface Props {",
      "+type Foo = string;",
      "+export const handler = () => {};",
      " function ignoredContext() {}",
    ].join("\n");
    expect(extractChangedSymbols(patch)).toEqual([
      "validatePassword",
      "LoginForm",
      "login_user",
      "Start",
      "Props",
      "Foo",
      "handler",
    ]);
  });

  it("falls back to a const/let/var name in the header context", () => {
    const patch = hunk(1, 1, 1, 2, "const useAuth = () => {", ["+  x"]);
    expect(extractChangedSymbols(patch)).toEqual(["useAuth"]);
  });

  it("dedupes symbols across the header and lines", () => {
    const patch = hunk(1, 1, 1, 2, "function validatePassword() {", [
      "+function validatePassword() {",
      "-function validatePassword() {",
    ]);
    expect(extractChangedSymbols(patch)).toEqual(["validatePassword"]);
  });

  it("skips modifiers captured after public/private", () => {
    const patch = hunk(1, 1, 1, 2, "", [
      "+  private readonly cache = new Map();",
      "+  public render() {",
    ]);
    expect(extractChangedSymbols(patch)).toEqual(["render"]);
  });

  it("skips single-character names", () => {
    const patch = hunk(1, 1, 1, 2, "const x = 1;", [
      "+function f() {}",
      "+function go() {}",
    ]);
    expect(extractChangedSymbols(patch)).toEqual(["go"]);
  });

  it("caps at 8 per hunk and 24 per file", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `+function f${i}() {}`);
    expect(extractChangedSymbols(hunk(1, 1, 1, 11, "", lines))).toHaveLength(8);

    const hunks = Array.from({ length: 4 }, (_, h) =>
      hunk(
        h * 20 + 1,
        1,
        h * 20 + 1,
        9,
        "",
        Array.from({ length: 8 }, (_, i) => `+class C${h}_${i} {}`)
      )
    );
    expect(extractChangedSymbols(hunks.join("\n"))).toHaveLength(24);
  });

  it("ignores prose before the first hunk and empty input", () => {
    expect(extractChangedSymbols("")).toEqual([]);
    expect(
      extractChangedSymbols("diff --git a/x b/x\nfunction nope() {}")
    ).toEqual([]);
  });
});

describe("buildDiffSummary", () => {
  it("returns an empty summary for an empty compare", () => {
    const summary = buildDiffSummary(compare([]), cfg);
    expect(summary).toEqual({
      baseSha: "base",
      headSha: "head",
      files: [],
      excludedFiles: [],
      totalFiles: 0,
      truncatedByProvider: false,
      truncatedByBudget: false,
      omittedFileCount: 0,
      estimatedTokens: 0,
    });
    expect(renderDiffSummaryForPrompt(summary)).toBe("");
  });

  it("excludes lockfiles, binaries, generated, vendored and minified files", () => {
    const summary = buildDiffSummary(
      compare([
        changed("pnpm-lock.yaml"),
        changed("logo.png", { isBinary: true }),
        changed("dist/bundle.js"),
        changed("vendor/x.go"),
        changed("app.min.js"),
        changed("src/a.ts", { patch: hunk(1, 1, 1, 2, "", ["+x"]) }),
      ]),
      cfg
    );
    expect(summary.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(summary.excludedFiles).toEqual([
      { path: "pnpm-lock.yaml", class: "lockfile" },
      { path: "logo.png", class: "binary" },
      { path: "dist/bundle.js", class: "generated" },
      { path: "vendor/x.go", class: "vendored" },
      { path: "app.min.js", class: "minified" },
    ]);
    expect(summary.totalFiles).toBe(6);
    expect(renderDiffSummaryForPrompt(summary)).toContain(
      "Excluded: 1 lockfile, 1 generated, 1 vendored, 1 minified, 1 binary"
    );
  });

  it("pluralizes lockfiles", () => {
    const summary = buildDiffSummary(
      compare([changed("yarn.lock"), changed("go.sum")]),
      cfg
    );
    expect(renderDiffSummaryForPrompt(summary)).toBe("Excluded: 2 lockfiles");
  });

  it("orders source → config → test → docs, then by churn", () => {
    const summary = buildDiffSummary(
      compare([
        changed("README.md"),
        changed("src/a.test.ts"),
        changed("tsconfig.json"),
        changed("src/small.ts", { additions: 1, deletions: 0 }),
        changed("src/big.ts", { additions: 30, deletions: 20 }),
      ]),
      cfg
    );
    expect(summary.files.map((f) => f.path)).toEqual([
      "src/big.ts",
      "src/small.ts",
      "tsconfig.json",
      "src/a.test.ts",
      "README.md",
    ]);
    expect(summary.files.map((f) => f.class)).toEqual([
      "source",
      "source",
      "config",
      "test",
      "docs",
    ]);
  });

  it("parses hunks with normalized headers and symbols", () => {
    const patch = [
      "@@ -1 +1 @@ export function validatePassword() {",
      "-old",
      "+new",
      "@@ -10,3 +10,4 @@",
      " ctx",
      "+export class LoginForm {}",
      " ctx",
      " ctx",
    ].join("\n");
    const summary = buildDiffSummary(
      compare([
        changed("src/auth/login.ts", { patch, additions: 42, deletions: 7 }),
      ]),
      cfg
    );
    const [file] = summary.files;
    expect(file.detail).toBe("patch");
    expect(file.hunks).toEqual([
      {
        header: "@@ -1,1 +1,1 @@ export function validatePassword() {",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        changedSymbols: ["validatePassword"],
      },
      {
        header: "@@ -10,3 +10,4 @@",
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 4,
        changedSymbols: ["LoginForm"],
      },
    ]);
    expect(file.patchExcerpt).toBe(patch);
    const rendered = renderDiffSummaryForPrompt(summary);
    expect(rendered.split("\n")[0]).toBe(
      "1. M src/auth/login.ts (+42/-7) symbols: validatePassword, LoginForm"
    );
    expect(rendered).toContain("\n  +export class LoginForm {}");
    expect(summary.estimatedTokens).toBe(Math.ceil(rendered.length / 4));
  });

  it("keeps whole hunks in the excerpt up to truncatePatchChars", () => {
    const body = (ch: string) => [`+${ch.repeat(100)}`];
    const patch = [
      hunk(1, 2, 1, 3, "ctxA", body("a")),
      hunk(20, 2, 21, 3, "ctxB", body("b")),
      hunk(40, 2, 42, 3, "ctxC", body("c")),
    ].join("\n");
    const summary = buildDiffSummary(
      compare([changed("src/a.ts", { patch })]),
      { ...cfg, truncatePatchChars: 250 }
    );
    const excerpt = summary.files[0].patchExcerpt ?? "";
    expect(excerpt.split("\n").filter((l) => l.startsWith("@@"))).toHaveLength(
      2
    );
    expect(excerpt).not.toContain("ccc");
    const rendered = renderDiffSummaryForPrompt(summary);
    expect(rendered).toContain("  @@ -40,2 +42,3 @@ ctxC");
    expect(rendered).not.toContain("ccc");

    const sliced = buildDiffSummary(compare([changed("src/a.ts", { patch })]), {
      ...cfg,
      truncatePatchChars: 50,
    });
    expect(sliced.files[0].patchExcerpt).toHaveLength(50);
  });

  it("degrades patch → hunks → path → omitted under a tight budget", () => {
    const body = Array.from(
      { length: 40 },
      (_, i) => `+  line ${i} of a fairly long patch body for budget tests`
    );
    const ctx = `export function ${"x".repeat(100)}() {`;
    const files = ["a", "b", "c", "d"].map((name, i) =>
      changed(`src/${name}.ts`, {
        additions: 40 - i,
        deletions: 0,
        patch: hunk(1, 3, 1, 43, ctx, body),
      })
    );

    const generous = buildDiffSummary(compare(files), cfg);
    expect(generous.files.map((f) => f.detail)).toEqual([
      "patch",
      "patch",
      "patch",
      "patch",
    ]);
    expect(generous.truncatedByBudget).toBe(false);

    const partial: DiffFileSummary[] = [
      generous.files[0],
      { ...generous.files[1], detail: "hunks", patchExcerpt: undefined },
      { ...generous.files[2], detail: "path", patchExcerpt: undefined },
    ];
    const rendered = renderDiffSummaryForPrompt({
      ...generous,
      files: partial,
    });
    const tokens = Math.ceil(rendered.length / 4);
    const tight = { ...cfg, diffTokenBudget: Math.ceil(tokens / 0.75) };

    const summary = buildDiffSummary(compare(files), tight);
    expect(summary.files.map((f) => f.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    expect(summary.files.map((f) => f.detail)).toEqual([
      "patch",
      "hunks",
      "path",
    ]);
    expect(summary.files[0].patchExcerpt).toContain("line 0 of");
    expect(summary.files[1].patchExcerpt).toBeUndefined();
    expect(summary.files[1].hunks[0].header).toBe(`@@ -1,3 +1,43 @@ ${ctx}`);
    expect(summary.files[2].patchExcerpt).toBeUndefined();
    expect(summary.truncatedByBudget).toBe(true);
    expect(summary.omittedFileCount).toBe(1);
    expect(summary.estimatedTokens).toBeLessThanOrEqual(tight.diffTokenBudget);

    const text = renderDiffSummaryForPrompt(summary);
    expect(text).toContain("2. M src/b.ts (+39/-0) [hunks only]");
    expect(text).toContain("3. M src/c.ts (+38/-0) [path only]");
    expect(text).toContain("(1 more changed files omitted)");
  });

  it("applies the per-request token cap", () => {
    const body = Array.from(
      { length: 40 },
      (_, i) => `+  line ${i} of body text`
    );
    const files = ["a", "b", "c", "d"].map((name) =>
      changed(`src/${name}.ts`, { patch: hunk(1, 3, 1, 43, "ctx", body) })
    );
    const summary = buildDiffSummary(compare(files), cfg, {
      maxTokensPerRequest: 1000,
    });
    expect(summary.files.map((f) => f.detail)).toEqual([
      "hunks",
      "hunks",
      "hunks",
      "hunks",
    ]);
    expect(summary.truncatedByBudget).toBe(false);
    expect(summary.estimatedTokens).toBeLessThanOrEqual(1000 * 0.35 * 0.75);
  });

  it("omits everything when nothing fits", () => {
    const summary = buildDiffSummary(
      compare([changed("src/a.ts"), changed("src/b.ts")]),
      { ...cfg, diffTokenBudget: 1 }
    );
    expect(summary.files).toEqual([]);
    expect(summary.truncatedByBudget).toBe(true);
    expect(summary.omittedFileCount).toBe(2);
  });

  it("limits patch detail to maxPatchFiles", () => {
    const files = ["a", "b", "c", "d"].map((name) =>
      changed(`src/${name}.ts`, { patch: hunk(1, 1, 1, 2, "", ["+x"]) })
    );
    const summary = buildDiffSummary(compare(files), {
      ...cfg,
      maxPatchFiles: 2,
    });
    expect(summary.files.map((f) => f.detail)).toEqual([
      "patch",
      "patch",
      "hunks",
      "hunks",
    ]);
  });

  it("uses path detail for files without a patch", () => {
    const summary = buildDiffSummary(
      compare([
        changed("src/a.ts"),
        changed("src/b.ts", { patchTruncated: true }),
      ]),
      cfg
    );
    expect(summary.files.map((f) => f.detail)).toEqual(["path", "path"]);
    expect(summary.files[0].hunks).toEqual([]);
  });

  it("caps the raw file list at maxDiffFiles before classifying", () => {
    const files = Array.from({ length: 6 }, (_, i) => changed(`src/f${i}.ts`));
    files[5] = changed("yarn.lock");
    const summary = buildDiffSummary(compare(files), {
      ...cfg,
      maxDiffFiles: 4,
    });
    expect(summary.files).toHaveLength(4);
    expect(summary.excludedFiles).toEqual([]);
    expect(summary.truncatedByBudget).toBe(true);
    expect(summary.omittedFileCount).toBe(2);
    expect(summary.totalFiles).toBe(6);
  });

  it("passes through provider truncation and totalFiles", () => {
    const summary = buildDiffSummary(
      compare([changed("src/a.ts")], { truncated: true, totalFiles: 900 }),
      cfg
    );
    expect(summary.truncatedByProvider).toBe(true);
    expect(summary.truncatedByBudget).toBe(false);
    expect(summary.totalFiles).toBe(900);
  });
});

describe("renderDiffSummaryForPrompt", () => {
  it("renders renames with both paths and status letters", () => {
    const summary = buildDiffSummary(
      compare([
        changed("src/new.ts", {
          status: "renamed",
          previousPath: "src/old.ts",
        }),
        changed("src/gone.ts", {
          status: "deleted",
          additions: 0,
          deletions: 9,
        }),
        changed("src/fresh.ts", {
          status: "added",
          additions: 9,
          deletions: 0,
        }),
      ]),
      cfg
    );
    const lines = renderDiffSummaryForPrompt(summary).split("\n");
    expect(lines).toContain("1. D src/gone.ts (+0/-9) [path only]");
    expect(lines).toContain("2. A src/fresh.ts (+9/-0) [path only]");
    expect(lines).toContain("3. R src/old.ts → src/new.ts (+1/-1) [path only]");
  });

  it("renders replacement-pattern characters in a patch verbatim", () => {
    const line = '+const re = "$&$1$<name>$$";';
    const summary = buildDiffSummary(
      compare([changed("src/a.ts", { patch: hunk(1, 1, 1, 2, "", [line]) })]),
      cfg
    );
    expect(summary.files[0].patchExcerpt).toContain(line);
    expect(renderDiffSummaryForPrompt(summary)).toContain(`  ${line}`);
  });

  it("never throws on odd input", () => {
    expect(renderDiffSummaryForPrompt({} as DiffSummary)).toBe("");
    expect(renderDiffSummaryForPrompt(null as unknown as DiffSummary)).toBe("");
    const odd = {
      files: [
        undefined,
        {
          path: "x",
          status: "weird",
          additions: "3",
          hunks: null,
          detail: "hunks",
        },
        { path: "y", status: "modified", detail: "patch", patchExcerpt: 5 },
      ],
      excludedFiles: [{ path: "z" }, null],
      omittedFileCount: "2",
    } as unknown as DiffSummary;
    const text = renderDiffSummaryForPrompt(odd);
    expect(text).toContain("2. ? x (+3/-0) [hunks only]");
    expect(text).toContain("3. M y (+0/-0)");
    expect(text).toContain("(2 more changed files omitted)");
  });
});
