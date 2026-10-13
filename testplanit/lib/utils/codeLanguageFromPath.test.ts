import Prism from "prismjs";
import { describe, expect, it } from "vitest";
import { highlightCode } from "./codeHighlight";
import {
  codeLanguageFromPath,
  PLAIN_TEXT_LANGUAGE,
} from "./codeLanguageFromPath";

describe("codeLanguageFromPath", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["components/Button.tsx", "typescript"],
    ["mod.mts", "typescript"],
    ["mod.cts", "typescript"],
    ["index.js", "javascript"],
    ["App.jsx", "javascript"],
    ["esm.mjs", "javascript"],
    ["cjs.cjs", "javascript"],
    ["main.py", "python"],
    ["app.rb", "ruby"],
    ["main.go", "go"],
    ["Main.java", "java"],
    ["Main.kt", "kotlin"],
    ["Program.cs", "csharp"],
    ["index.php", "php"],
    ["main.rs", "rust"],
    ["App.swift", "swift"],
    ["main.c", "c"],
    ["main.h", "c"],
    ["main.cpp", "cpp"],
    ["main.cc", "cpp"],
    ["main.hpp", "cpp"],
    ["package.json", "json"],
    [".github/workflows/ci.yml", "yaml"],
    ["config.yaml", "yaml"],
    ["README.md", "markdown"],
    ["index.html", "markup"],
    ["index.htm", "markup"],
    ["App.vue", "markup"],
    ["App.svelte", "markup"],
    ["pom.xml", "markup"],
    ["styles.css", "css"],
    ["styles.scss", "scss"],
    ["run.sh", "bash"],
    ["run.bash", "bash"],
    ["query.sql", "sql"],
    ["login.feature", "gherkin"],
    ["Dockerfile", "docker"],
    ["docker/Dockerfile", "docker"],
    ["Dockerfile.prod", "docker"],
    ["app.dockerfile", "docker"],
    ["lib/main.dart", "dart"],
    ["Build.scala", "scala"],
    ["script.lua", "lua"],
    ["src\\windows\\app.ts", "typescript"],
  ])("%s -> %s", (path, expected) => {
    expect(codeLanguageFromPath(path)).toBe(expected);
  });

  it("ignores case in the extension and file name", () => {
    expect(codeLanguageFromPath("SRC/APP.TS")).toBe("typescript");
    expect(codeLanguageFromPath("DOCKERFILE")).toBe("docker");
    expect(codeLanguageFromPath("Readme.MD")).toBe("markdown");
  });

  it.each([
    ["archive.tar.gz"],
    ["notes.unknownext"],
    ["LICENSE"],
    [".gitignore"],
    ["trailing."],
    [""],
    ["   "],
    ["dir/"],
  ])("falls back to plain text for %j", (path) => {
    expect(codeLanguageFromPath(path)).toBe(PLAIN_TEXT_LANGUAGE);
  });

  it("only returns ids Prism has loaded, so highlighting never throws", () => {
    const paths = [
      "a.ts",
      "a.cpp",
      "a.scss",
      "Dockerfile",
      "a.feature",
      "a.dart",
      "a.unknown",
      "",
    ];
    for (const path of paths) {
      const id = codeLanguageFromPath(path);
      expect(Prism.languages[id]).toBeDefined();
      expect(() => highlightCode("const x = 1;", id)).not.toThrow();
    }
  });

  it("renders plain text unhighlighted and escaped", () => {
    const html = highlightCode(
      "<b>1</b>",
      codeLanguageFromPath("notes.unknownext")
    );
    expect(html).toBe("&lt;b>1&lt;/b>");
  });
});
