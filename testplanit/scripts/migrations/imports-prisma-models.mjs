#!/usr/bin/env node
/**
 * Phase 2a import codemod: rewrite `@prisma/client` model-type and enum imports
 * to the generated v3 client at `~/zenstack/models`. Enums are runtime values
 * (`export const`) so they import as values; model types are type-only.
 *
 * `Prisma` and `PrismaClient` are left in a residual `@prisma/client` import for
 * the Phase 2b namespace pass. Idempotent and re-runnable (safe after a rebase).
 *
 * Run from the testplanit dir: node scripts/migrations/imports-prisma-models.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const modelsSrc = fs.readFileSync(path.join(ROOT, "zenstack/models.ts"), "utf8");
const enums = new Set([...modelsSrc.matchAll(/^export const (\w+)/gm)].map((m) => m[1]));
const allTypes = new Set([...modelsSrc.matchAll(/^export type (\w+)/gm)].map((m) => m[1]));
const modelTypes = new Set([...allTypes].filter((t) => !enums.has(t)));
const isModelName = (n) => enums.has(n) || modelTypes.has(n);

const SKIP_DIRS = new Set(["node_modules", ".next", "zenstack", "dist", ".git", "coverage"]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
    } else if (/\.tsx?$/.test(e.name)) {
      files.push(path.join(dir, e.name));
    }
  }
})(ROOT);

// import (type)? { body } from "@prisma/client"
const IMPORT_RE =
  /^([ \t]*)import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']@prisma\/client["'];?[ \t]*$/gm;

let filesChanged = 0;
const residual = []; // files still importing @prisma/client after 2a (the 2b set)

for (const file of files) {
  let src = fs.readFileSync(file, "utf8");
  if (!src.includes('"@prisma/client"') && !src.includes("'@prisma/client'")) continue;

  const out = src.replace(IMPORT_RE, (full, indent, wholeType, body) => {
    const specs = body
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const inlineType = /^type\s+/.test(s);
        const text = s.replace(/^type\s+/, "");
        const base = text.split(/\s+as\s+/)[0].trim();
        return { text, base, inlineType };
      });

    const modelSpecs = specs.filter((s) => isModelName(s.base));
    const specialSpecs = specs.filter((s) => !isModelName(s.base));
    if (modelSpecs.length === 0) return full; // pure Prisma/PrismaClient -> leave for 2b

    const typeNames = [];
    const valueNames = [];
    for (const s of modelSpecs) {
      const asType = !!wholeType || s.inlineType || modelTypes.has(s.base);
      (asType ? typeNames : valueNames).push(s.text);
    }

    const lines = [];
    if (valueNames.length)
      lines.push(`${indent}import { ${valueNames.join(", ")} } from "~/zenstack/models";`);
    if (typeNames.length)
      lines.push(`${indent}import type { ${typeNames.join(", ")} } from "~/zenstack/models";`);
    if (specialSpecs.length) {
      const tprefix = wholeType ? "type " : "";
      lines.push(
        `${indent}import ${tprefix}{ ${specialSpecs.map((s) => s.text).join(", ")} } from "@prisma/client";`,
      );
    }
    return lines.join("\n");
  });

  if (out !== src) {
    fs.writeFileSync(file, out);
    filesChanged++;
  }
  if (out.includes('from "@prisma/client"')) residual.push(path.relative(ROOT, file));
}

console.log(`Phase 2a: rewrote @prisma/client model/enum imports in ${filesChanged} file(s).`);
console.log(`\nResidual @prisma/client importers (Prisma / PrismaClient -> handle in 2b): ${residual.length}`);
for (const f of residual.sort()) console.log("  -", f);
