#!/usr/bin/env node
/**
 * Phase 5 codemod: convert v2 `enhance(client, { user: U })` access-control
 * calls to v3 `getAuthDb(U)` (= policyClient.$setAuth(U)) in non-test app code.
 * Import `enhance` from "@zenstackhq/runtime" -> `getAuthDb` from "~/lib/zenstack".
 * Idempotent. (Test files use enhance() as their own harness — handled in Phase 7.)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", "zenstack", "dist", ".git", "coverage"]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); }
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) files.push(path.join(dir, e.name));
  }
})(ROOT);

let changed = 0;
const leftover = [];
for (const file of files) {
  let src = fs.readFileSync(file, "utf8");
  if (!/from "@zenstackhq\/runtime"/.test(src)) continue;

  // enhance(<client>, { user: <expr> })  ->  getAuthDb(<expr>)
  const before = src;
  src = src.replace(
    /\benhance\(\s*[A-Za-z_$][\w$]*\s*,\s*\{\s*user:\s*([^}]+?)\s*\}\s*\)/g,
    (_m, expr) => `getAuthDb(${expr.trim()})`,
  );

  // swap the import
  src = src.replace(
    /^[ \t]*import\s+\{\s*enhance\s*\}\s+from\s+"@zenstackhq\/runtime";[ \t]*\n/m,
    src.includes('from "~/lib/zenstack"') && /getAuthDb/.test(src) && !/import[^\n]*getAuthDb[^\n]*~\/lib\/zenstack/.test(before)
      ? `import { getAuthDb } from "~/lib/zenstack";\n`
      : `import { getAuthDb } from "~/lib/zenstack";\n`,
  );

  if (src !== before) { fs.writeFileSync(file, src); changed++; }
  if (/from "@zenstackhq\/runtime"/.test(src)) leftover.push(path.relative(ROOT, file));
}
console.log(`enhance() -> getAuthDb() in ${changed} file(s).`);
if (leftover.length) { console.log("still importing @zenstackhq/runtime (review):"); leftover.forEach((f) => console.log("  " + f)); }
