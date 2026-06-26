#!/usr/bin/env node
/**
 * Phase 2 tail: replace bare `new PrismaClient()` (seed scripts, one-off scripts,
 * e2e tests) with the v3 `createRawDbClient()` factory from ~/lib/rawDbClient,
 * and drop `PrismaClient` from the @prisma/client import. Idempotent.
 *
 * Skips `new PrismaClient({...})` with args (only lib/multiTenantPrisma.ts; that
 * per-tenant factory is migrated by hand).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "zenstack",
  "dist",
  ".git",
  "coverage",
]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
    } else if (/\.tsx?$/.test(e.name)) files.push(path.join(dir, e.name));
  }
})(ROOT);

let changed = 0;
for (const file of files) {
  if (file.endsWith(path.join("lib", "rawDbClient.ts"))) continue; // never rewrite the factory itself
  let src = fs.readFileSync(file, "utf8");
  if (!/new PrismaClient\(\)/.test(src)) continue;

  let out = src.replace(/new PrismaClient\(\)/g, "createRawDbClient()");

  // Drop PrismaClient from the @prisma/client import; keep Prisma if also imported.
  out = out.replace(
    /^([ \t]*)import\s+\{([^}]*)\}\s+from\s+["']@prisma\/client["'];?[ \t]*$/m,
    (full, indent, body) => {
      const names = body
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && !/^(type\s+)?PrismaClient$/.test(s));
      return names.length
        ? `${indent}import { ${names.join(", ")} } from "@prisma/client";`
        : "";
    }
  );

  // Add the factory import by PREPENDING before the first import (safe even when
  // the first import is multi-line; inserting after the first line would split it).
  if (!out.includes('from "~/lib/rawDbClient"')) {
    out = out.replace(
      /^(import\b)/m,
      `import { createRawDbClient } from "~/lib/rawDbClient";\n$1`
    );
  }

  if (out !== src) {
    fs.writeFileSync(file, out);
    changed++;
  }
}
console.log(
  `Replaced new PrismaClient() with createRawDbClient() in ${changed} file(s).`
);
const left = files.filter(
  (f) =>
    fs.existsSync(f) && /new PrismaClient\(/.test(fs.readFileSync(f, "utf8"))
);
console.log(
  `Remaining 'new PrismaClient(' (with-args, manual): ${left.length}`
);
for (const f of left) console.log("  -", path.relative(ROOT, f));
