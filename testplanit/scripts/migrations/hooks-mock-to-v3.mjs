#!/usr/bin/env node
// Codemod: convert v2 `vi.mock("~/lib/hooks", () => ({ useOpModel: impl, ... }))`
// test mocks into the v3 grouped-client shape:
//   vi.mock("@zenstackhq/tanstack-query/react", () => ({
//     useClientQueries: () => ({ <model>: { <useOp>: impl }, ... }),
//   }))
//
// Also drops bare `vi.mock("~/lib/hooks");` auto-mocks (the global useClientQueries
// stub in vitest.setup.tsx covers those) and `import { ... } from "~/lib/hooks"`
// lines. Files whose factory keys don't all parse as use<Op><Model> are SKIPPED
// (logged) for manual handling. Pass file paths as argv; "--dry" prints diffs.
import { readFileSync, writeFileSync } from "node:fs";

const OPS = [
  "InfiniteFindMany",
  "FindMany",
  "FindFirst",
  "FindUnique",
  "CreateMany",
  "Create",
  "UpdateMany",
  "Update",
  "Upsert",
  "DeleteMany",
  "Delete",
  "Count",
  "GroupBy",
  "Aggregate",
];

function parseHookName(name) {
  if (!name.startsWith("use")) return null;
  const rest = name.slice(3);
  for (const op of OPS) {
    if (rest.startsWith(op) && rest.length > op.length) {
      const model = rest.slice(op.length);
      const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
      return { modelKey, op: "use" + op };
    }
  }
  return null;
}

// Split the body of an object literal into top-level "key: value" entries,
// tracking (){}[ ] depth and strings so nested vi.fn(() => ({...})) survive.
function splitEntries(body) {
  const entries = [];
  let depth = 0,
    start = 0,
    inStr = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === inStr && body[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      entries.push(body.slice(start, i));
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) entries.push(tail);
  return entries.map((e) => e.trim()).filter(Boolean);
}

// Find ALL `vi.mock("~/lib/hooks[/subpath]", () => ({ ... }))` factories
// (returns list sorted by position). Subpath modules (e.g. ~/lib/hooks/issue)
// were custom composed hooks now folded into useClientQueries; multiple per
// file get merged into a single grouped mock.
const FACTORY_RE =
  /vi\.mock\(\s*["'](?:~|@)\/lib\/hooks(?:\/[\w-]+)?["']\s*,\s*\(\)\s*=>\s*\(\{/g;
function findAllFactories(src) {
  const out = [];
  for (const m of src.matchAll(FACTORY_RE)) {
    const open = m.index + m[0].length; // just after `({`
    let depth = 1,
      i = open,
      inStr = null;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (inStr) {
        if (c === inStr && src[i - 1] !== "\\") inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") inStr = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    const after = src.slice(i).match(/^\s*\)\s*\)\s*;?/);
    if (!after) return null; // bail the whole file if any factory is malformed
    out.push({
      start: m.index,
      end: i + after[0].length,
      body: src.slice(open, i - 1),
    });
  }
  return out;
}

function transform(src, file) {
  let out = src;

  // Hooks imported by name are referenced in the test body (vi.mocked(useX) /
  // (useX as ...)). They must be hoisted vi.fn()s wired INTO the mock, not
  // inline impls, so per-test mockReturnValue / assertions keep working.
  const referenced = new Set();
  for (const im of out.matchAll(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:~|@)\/lib\/hooks(?:\/[\w-]+)?["']/g
  )) {
    im[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((n) => referenced.add(n));
  }

  const factories = findAllFactories(out);
  if (factories === null) return { skip: "malformed vi.mock factory" };
  if (factories.length) {
    const grouped = {};
    const hoist = [];
    for (const factory of factories) {
      const cleanBody = factory.body
        .split("\n")
        .filter((l) => !/^\s*\/\//.test(l))
        .join("\n");
      for (const entry of splitEntries(cleanBody)) {
        const colon = entry.indexOf(":");
        if (colon === -1)
          return { skip: `entry has no colon: ${entry.slice(0, 40)}` };
        const key = entry
          .slice(0, colon)
          .trim()
          .replace(/^["']|["']$/g, "");
        const value = entry.slice(colon + 1).trim();
        const parsed = parseHookName(key);
        if (!parsed) return { skip: `unparsed hook key: ${key}` };
        if (referenced.has(key)) {
          hoist.push(key);
          (grouped[parsed.modelKey] ??= []).push(`${parsed.op}: ${key}`);
        } else {
          (grouped[parsed.modelKey] ??= []).push(`${parsed.op}: ${value}`);
        }
      }
    }
    const groupedStr = Object.entries(grouped)
      .map(([model, ops]) => `    ${model}: { ${ops.join(", ")} },`)
      .join("\n");
    const hoistStr = hoist.length
      ? `const { ${hoist.join(", ")} } = vi.hoisted(() => ({\n${hoist
          .map((h) => `  ${h}: vi.fn(),`)
          .join("\n")}\n}));\n`
      : "";
    const replacement = `${hoistStr}vi.mock("@zenstackhq/tanstack-query/react", () => ({\n  useClientQueries: () => ({\n${groupedStr}\n  }),\n}));`;
    // Replace from last factory to first so offsets stay valid; the first
    // becomes the merged mock, the rest are removed.
    for (let k = factories.length - 1; k >= 0; k--) {
      const f = factories[k];
      const repl = k === 0 ? replacement : "";
      out = out.slice(0, f.start) + repl + out.slice(f.end);
    }
  }

  // Drop bare auto-mocks of lib/hooks (global stub covers rendering).
  out = out.replace(
    /^\s*vi\.mock\(\s*["'](?:~|@)\/lib\/hooks(?:\/[\w-]+)?["']\s*\)\s*;?\s*$/gm,
    ""
  );

  // Drop import lines from lib/hooks (referenced names are hoisted above).
  out = out.replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+["'](?:~|@)\/lib\/hooks(?:\/[\w-]+)?["']\s*;?\s*$/gm,
    ""
  );

  return { out };
}

const dry = process.argv.includes("--dry");
const files = process.argv.slice(2).filter((a) => a !== "--dry");
let changed = 0,
  skipped = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!/(?:~|@)\/lib\/hooks/.test(src)) continue;
  const res = transform(src, file);
  if (res.skip) {
    console.log(`SKIP ${file} — ${res.skip}`);
    skipped++;
    continue;
  }
  if (res.out !== src) {
    if (dry) console.log(`WOULD CHANGE ${file}`);
    else writeFileSync(file, res.out);
    changed++;
  }
}
console.log(
  `${dry ? "would change" : "changed"}: ${changed}, skipped: ${skipped}`
);
