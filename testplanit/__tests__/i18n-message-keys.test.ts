import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * i18n key backstop.
 *
 * `global.ts` loosens next-intl's `Messages` type (the full en-US.json literal
 * overflowed tsc's union-complexity limit — TS2590), so `tsc` no longer
 * validates translation keys. This test statically recovers the high-value
 * part of that coverage: every `useTranslations("ns")` / `getTranslations("ns")`
 * namespace and every `t("key")` string literal must resolve in the
 * source-of-truth catalog (messages/en-US.json).
 *
 * It is deliberately conservative to avoid false positives: it only inspects
 * string-literal namespaces and keys and skips anything it cannot resolve
 * statically — template literals, computed keys, and translators not bound via
 * a local `useTranslations`/`getTranslations`. It does NOT check ICU argument
 * shapes.
 */

const ROOT = process.cwd();
const SOURCE_DIRS = ["app", "components", "lib", "server", "workers", "hooks"];

const messages = JSON.parse(
  fs.readFileSync(path.join(ROOT, "messages", "en-US.json"), "utf8")
) as Record<string, unknown>;

/** DYNAMIC = translator bound to a non-literal namespace (skip its keys). */
const DYNAMIC = Symbol("dynamic");

function resolvePath(dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      messages
    );
}

function listSourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of SOURCE_DIRS) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) continue;
    for (const rel of fs.readdirSync(base, { recursive: true }) as string[]) {
      if (!rel.endsWith(".ts") && !rel.endsWith(".tsx")) continue;
      if (rel.endsWith(".d.ts")) continue;
      if (/\.(test|spec)\.tsx?$/.test(rel)) continue;
      out.push(path.join(base, rel));
    }
  }
  return out;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content[i] === "\n") line++;
  return line;
}

interface Issue {
  file: string;
  line: number;
  message: string;
}

interface Binding {
  name: string;
  ns: string | typeof DYNAMIC;
  index: number;
}

function checkFile(absPath: string, issues: Issue[]): void {
  const content = fs.readFileSync(absPath, "utf8");
  const relFile = path.relative(ROOT, absPath);

  // 1) Collect every translator binding with its source position. A file may
  //    bind the same name (usually `t`) more than once — one per component, or
  //    a scoped one plus an unscoped one for a Zod schema factory — so we keep
  //    them all and resolve each call against the nearest binding above it.
  const bindings: Binding[] = [];
  const bindRe =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = bindRe.exec(content))) {
    const rawArg = m[2].trim();
    const lit =
      rawArg === "" ? ["", "", ""] : rawArg.match(/^(["'])((?:(?!\1).)*)\1$/);
    bindings.push({
      name: m[1],
      ns: rawArg === "" ? "" : lit ? lit[2] : DYNAMIC,
      index: m.index,
    });
  }
  if (bindings.length === 0) return;

  // 2) Namespace literals must resolve to an object in the catalog.
  const reportedNs = new Set<string>();
  for (const b of bindings) {
    if (b.ns === DYNAMIC || b.ns === "" || reportedNs.has(b.ns)) continue;
    const resolved = resolvePath(b.ns);
    if (resolved === undefined || typeof resolved !== "object") {
      reportedNs.add(b.ns);
      issues.push({
        file: relFile,
        line: lineOf(content, b.index),
        message: `unknown i18n namespace "${b.ns}" (via ${b.name})`,
      });
    }
  }

  // 3) Literal keys resolve against the nearest preceding binding of that name.
  const names = new Set(bindings.map((b) => b.name));
  for (const name of names) {
    const callRe = new RegExp(
      `(?<!\\.)\\b${name}(?:\\.(?:rich|markup|raw|has))?\\(\\s*(["'])((?:(?!\\1).)*)\\1`,
      "g"
    );
    let c: RegExpExecArray | null;
    while ((c = callRe.exec(content))) {
      const callIdx = c.index;
      const binding = bindings
        .filter((b) => b.name === name && b.index < callIdx)
        .sort((a, z) => z.index - a.index)[0];
      if (!binding || binding.ns === DYNAMIC) continue;
      const key = c[2];
      const full = binding.ns ? `${binding.ns}.${key}` : key;
      if (resolvePath(full) === undefined) {
        issues.push({
          file: relFile,
          line: lineOf(content, callIdx),
          message: `missing i18n key "${full}" (via ${name}("${key}"))`,
        });
      }
    }
  }
}

describe("i18n message keys", () => {
  it("every static useTranslations namespace and t() key resolves in en-US.json", () => {
    const issues: Issue[] = [];
    for (const file of listSourceFiles()) checkFile(file, issues);

    const report = issues
      .map((i) => `  ${i.file}:${i.line} — ${i.message}`)
      .join("\n");
    expect(report, `Unresolved i18n references:\n${report}`).toBe("");
  });
});
