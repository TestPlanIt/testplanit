#!/usr/bin/env node
/**
 * Phase 4 codemod: convert v2 generated ZenStack hooks (useFindManyProjects,
 * useCreateTags, ...) imported from ~/lib/hooks (deleted in v3) to the v3
 * runtime grouped-client API, inline:
 *   useFindManyProjects(args, opts)
 *     -> useClientQueries(schema).projects.useFindMany(args, opts)
 * Inline preserves v3's per-call generic inference (select/include narrowing)
 * and avoids placing a `const client = useClientQueries(schema)` line.
 *
 * Idempotent. Dry-run: DRY=1 node scripts/migrations/hooks-v2-to-v3.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DRY = process.env.DRY === "1";

const modelsSrc = fs.readFileSync(path.join(ROOT, "zenstack/models.ts"), "utf8");
const MODELS = [...modelsSrc.matchAll(/^export type (\w+) = \$ModelResult/gm)].map((m) => m[1]);
MODELS.sort((a, b) => b.length - a.length); // longest-first for suffix match
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// v3 op-parts (the segment between "use" and the model name)
const OPS = new Set([
  "FindMany", "FindUnique", "FindFirst", "InfiniteFindMany",
  "Create", "CreateMany", "CreateManyAndReturn",
  "Update", "UpdateMany", "UpdateManyAndReturn", "Upsert",
  "Delete", "DeleteMany", "Count", "Aggregate", "GroupBy", "Exists",
  "SuspenseFindMany", "SuspenseFindUnique", "SuspenseFindFirst",
  "SuspenseInfiniteFindMany", "SuspenseCount", "SuspenseAggregate", "SuspenseGroupBy",
]);

/** "useFindManyRepositoryCases" -> { accessor:"repositoryCases", method:"useFindMany" } or null */
function parseHook(name) {
  if (!name.startsWith("use")) return null;
  const rest = name.slice(3);
  for (const m of MODELS) {
    if (rest.endsWith(m)) {
      const op = rest.slice(0, rest.length - m.length);
      if (OPS.has(op)) return { accessor: lowerFirst(m), method: "use" + op };
    }
  }
  return null;
}

const HOOKS_IMPORT_RE =
  /^[ \t]*import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'][~@]\/lib\/hooks(?:\/[^"']*)?["'];?[ \t]*\n/gm;

const SKIP_DIRS = new Set(["node_modules", ".next", "zenstack", "dist", ".git", "coverage"]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); }
    // Skip test/spec files: they mock the v2 named hooks as object keys
    // (vi.mock("~/lib/hooks", () => ({ useFindManyX: vi.fn() }))) — converting
    // those needs a different v3 strategy (Phase 7), not this inline codemod.
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) files.push(path.join(dir, e.name));
  }
})(ROOT);

let changed = 0;
const unparsed = new Map(); // name -> count (imported from lib/hooks but not a known hook)
const sampleDry = [];

for (const file of files) {
  let src = fs.readFileSync(file, "utf8");
  if (!/[~@]\/lib\/hooks/.test(src)) continue;

  // local-name -> replacement expression
  const repl = new Map();
  let importsRemoved = false;

  src = src.replace(HOOKS_IMPORT_RE, (full, typeOnly, body) => {
    const specs = body.split(",").map((s) => s.trim()).filter(Boolean);
    let keptUnparsed = [];
    for (const spec of specs) {
      const [orig, alias] = spec.split(/\s+as\s+/).map((x) => x.trim());
      const local = alias || orig;
      const parsed = parseHook(orig);
      if (parsed) {
        repl.set(local, `useClientQueries(schema).${parsed.accessor}.${parsed.method}`);
      } else {
        keptUnparsed.push(spec);
        unparsed.set(orig, (unparsed.get(orig) || 0) + 1);
      }
    }
    importsRemoved = true;
    // Drop the line entirely; if there were unparsed (non-hook) specs, keep them (rare) — flagged.
    return keptUnparsed.length ? full : "";
  });

  if (repl.size === 0) continue;

  // Replace each local hook identifier with the inline grouped-client expression.
  for (const [local, expr] of repl) {
    src = src.replace(new RegExp(`\\b${local}\\b`, "g"), expr);
  }

  // Inject the two v3 imports BEFORE the first import statement (prepending is
  // safe even when the first import is multi-line; inserting "after the first
  // line" would split a multi-line `import { ... }` block).
  if (!/from "@zenstackhq\/tanstack-query\/react"/.test(src)) {
    src = src.replace(/^(import\b)/m,
      `import { useClientQueries } from "@zenstackhq/tanstack-query/react";\nimport { schema } from "~/zenstack/schema";\n$1`);
  }

  changed++;
  if (DRY) {
    if (sampleDry.length < 3) sampleDry.push({ file: path.relative(ROOT, file), hooks: [...repl.keys()] });
  } else {
    fs.writeFileSync(file, src);
  }
}

console.log(`${DRY ? "[DRY] would convert" : "converted"} ${changed} file(s).`);
if (unparsed.size) {
  console.log(`\nNon-hook names imported from lib/hooks (left in place — review):`);
  for (const [n, c] of [...unparsed.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n} (x${c})`);
}
if (DRY) for (const s of sampleDry) console.log(`\n${s.file}\n  hooks: ${s.hooks.join(", ")}`);
