// Structural gate: no client-bundled module in this codebase's requirements
// surface may transitively reach the database/queue layer via a VALUE
// import. Co-located under lib/services/ so it runs inside `pnpm precommit`,
// the always-on unit lane, matching this file family's own convention
// (issueRoleScope.containment.test.ts, linkedIssueUpsert.containment.test.ts).
//
// THE INCIDENT THIS GATE EXISTS TO CLOSE (commit 97824fde4, "keep the
// database layer out of the requirements page bundle"): `hooks/useRequirementsTree.ts`
// imported `REQUIREMENT_LAZY_THRESHOLD` as a runtime VALUE from
// `~/lib/services/requirementTree`, which does `import { baseDb } from
// "~/lib/db"` and builds raw Kysely SQL. That pulled the database layer into
// the client bundle; Turbopack could not build the client entry, emitted no
// build-manifest, and the requirements page 500'd in dev with an ENOENT
// naming the manifest rather than the cause. The ENTIRE unit suite
// (13,838 tests) passed throughout, because every unit test imports its
// module directly in node -- nothing in that suite ever exercises a
// bundler's client/server split. `tsc` also passed, because a type import is
// erased at compile time and a VALUE import of a well-typed module
// type-checks fine; only an actual bundler run distinguishes the two, and
// this gate is the fast, no-bundler-required proxy for that distinction: it
// reads the same fact (is this binding a value or a type?) directly from
// source text, rather than waiting for `next build`/`next dev` to fail.
//
// SCOPE (the widest this gate can stay reliable, stated explicitly per this
// plan's own instruction): every file under `hooks/` (all 74 non-test
// files, the shared client-hook layer this incident's own root cause lived
// in), plus every file under `app/[locale]/projects/requirements/**` that
// carries a `"use client"` directive (13 files -- the exact surface the
// incident hit). A repo-wide `"use client"` sweep would touch 538 tracked
// files across the whole app; reviewing that many call sites reliably in one
// gate-construction pass (adjudicating each new false positive, writing a
// reason for each genuine exemption) is far more than this specific,
// root-caused bug warrants, and doing it carelessly would produce a gate
// nobody trusts. Scoping narrower than "hooks/ + the requirements surface"
// was rejected for the opposite reason: the bug's own root cause was a
// hooks/ file, and the requirements surface is this phase's stated subject.
//
// THE GRAPH WALK IS NOT LIMITED TO THE SCOPE LIST: only the STARTING files
// are chosen by the scope above; the recursive walk itself follows every
// resolvable internal VALUE import wherever it leads (e.g. a scoped
// hooks/*.ts file that imports the un-scoped, non-"use client"
// requirementsListRows.ts still has that file's own imports walked, since
// requirementsListRows.ts is reachable from a scoped entry point). This is
// deliberate: the property this gate proves is "nothing REACHABLE from the
// client bundle's own entry points touches the server layer", not "every
// file that happens to carry a 'use client' tag is individually clean".
//
// SERVER-ONLY MARKERS, per this plan's own instruction to verify rather than
// hardcode blindly: `~/lib/db` (lib/db.ts, confirmed: re-exports ZenStack's
// baseClient/policyClient), `~/lib/zenstack` (lib/zenstack.ts, confirmed:
// the actual ZenStackClient factory -- the true root every other DB shim
// re-exports from), `server/db` (server/db.ts, confirmed: a v2-compat shim
// re-exporting ZenStack's rawClient), `kysely` (confirmed: imported as a
// real VALUE -- the `sql` tagged-template builder -- by
// lib/services/requirementTree.ts, this incident's own second-order cause),
// `bullmq` and `ioredis` (confirmed: the job-queue and cache/session-store
// packages named in this repo's own CLAUDE.md tech stack, real dependencies
// of lib/integrations/services/SyncService.ts and lib/valkey.ts
// respectively). `~/lib/prisma` is ALSO checked, per the plan's own
// instruction, but verified NOT to exist anywhere in this codebase (`ls
// lib/prisma.ts` -- no such file; this codebase's Prisma singleton was
// superseded by the ZenStack v3 migration) -- kept in the marker list for
// parity with the instruction, permanently inert since it can never resolve
// to a real file. The first three markers are matched against the
// RESOLVED FILE PATH (not the literal specifier text), so "~/lib/db",
// "./db" and "../../lib/db" from different importers are all recognized as
// the same file; the last three are matched against the bare package name
// (and any `<pkg>/subpath` import of it), since a package has no on-disk
// "resolved path" this walk can follow further.
//
// THE "use server" BOUNDARY (a real one this gate must not false-positive
// on): a module marked `"use server"` at its top is Next.js's OWN inverse
// client/server boundary -- the compiler turns its exports into an RPC stub
// for the client bundle, so whatever THAT module's own imports reach never
// ships to the browser, regardless of what they are. Several hooks/* files
// legitimately import a Server Action that itself imports `~/lib/db` or
// `~/server/db` (e.g. hooks/useAccessibleProjectsForUsers.ts ->
// app/actions/getUserAccessibleProjects.ts -> ~/lib/db) -- this gate must
// stop walking at a "use server" file's own boundary, or it would flag
// dozens of legitimate, already-shipped Server Action calls as violations
// and teach the next reader to distrust (or silently weaken) the gate. A
// dedicated test below pins this against a real chain in this codebase,
// not a synthetic one.
//
// TYPE-ONLY IMPORTS DO NOT COUNT, by design and by the very fix this gate
// exists to protect: `import type ...` and `import { type X, ... }` (every
// named binding prefixed `type`) are erased at compile time and cost
// nothing at runtime -- exactly what hooks/useRequirementsTree.ts's own
// header comment states about its own import of requirementTree.ts. The
// CURRENT, corrected code must pass this gate; its pre-fix (value-import)
// form must fail it. The mutation-prove test below reproduces the exact
// historical bug and reverts it.
//
// LIMITATIONS, disclosed rather than hidden (the same posture
// issueRoleScope.containment.test.ts takes for its own git-grep blind
// spots): (1) `git ls-files` only sees TRACKED files -- an uncommitted new
// client file is invisible to this gate until it is staged. (2) a dynamic
// `import(...)` call is invisible to this static, regex-based parser -- no
// file in this gate's scope uses one today (checked at construction time;
// if one is ever added, this gate will not see the module it loads). (3)
// path aliases are resolved textually against a copy of tsconfig.json's own
// `paths` table (`~/`, and every `@/...` sub-mapping), not through the real
// TypeScript compiler -- if that table's shape ever changes, this gate's
// resolver needs a matching update, or it will silently stop walking
// whichever alias moved (the scope-floor test below is the trip-wire that
// would catch a resolver silently returning zero hits for the whole gate,
// though not a single moved alias resolving to the wrong, still-valid file).

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function gitLsFiles(pathspecs: string[]): string[] {
  const raw = execSync(
    `git ls-files -- ${pathspecs.map((p) => `'${p}'`).join(" ")}`,
    { cwd: ROOT, encoding: "utf8" }
  );
  return raw.split("\n").filter(Boolean);
}

function isTestPath(filePath: string): boolean {
  return /\.test\.tsx?$/.test(filePath) || /\.spec\.tsx?$/.test(filePath);
}

function hasDirective(content: string, directive: string): boolean {
  const head = content.split("\n").slice(0, 5).join("\n");
  const re = new RegExp(`^\\s*["']${directive}["'];?\\s*$`, "m");
  return re.test(head);
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

function resolveScope(): string[] {
  const hooksFiles = gitLsFiles(["hooks/*.ts", "hooks/*.tsx"]).filter(
    (f) => !isTestPath(f)
  );
  const requirementsCandidates = gitLsFiles([
    "app/\\[locale\\]/projects/requirements/*",
    "app/\\[locale\\]/projects/requirements/**/*",
  ]).filter((f) => !isTestPath(f) && /\.tsx?$/.test(f));
  const requirementsClientFiles = requirementsCandidates.filter((f) => {
    const content = readFileSync(path.join(ROOT, f), "utf8");
    return hasDirective(content, "use client");
  });
  return Array.from(new Set([...hooksFiles, ...requirementsClientFiles]));
}

// ---------------------------------------------------------------------------
// Import extraction -- distinguishes a VALUE import from a type-only one.
// Deliberately regex/text-based (not a full TS parser), matching this file
// family's own established technique rather than adding a new dependency.
// ---------------------------------------------------------------------------

function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\s/.test(trimmed)) return true; // `import type X from "y"` / `export type { X } from "y"` / `import type * as X from "y"`
  const braceMatch = /\{([\s\S]*)\}/.exec(trimmed);
  if (braceMatch) {
    const outsideBraces = trimmed.replace(braceMatch[0], "").trim();
    // A default import alongside the braces (`import Def, { X } from "y"`)
    // still carries a real value binding (Def) -- only pure `{ ... }` with
    // every named binding prefixed `type` is type-only.
    if (outsideBraces.replace(/,$/, "").trim() !== "") return false;
    const bindings = braceMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return bindings.length > 0 && bindings.every((b) => /^type\s/.test(b));
  }
  return false;
}

// Matches `import <clause> from "spec"` and `export <clause> from "spec"`
// (re-exports), including `export * from "spec"`. Non-greedy so a multi-line
// named-import clause is captured without spanning past the first `from`.
const IMPORT_RE =
  /^\s*(?:import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/gm;
// Side-effect-only imports: `import "spec";`, no binding at all.
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s+["']([^"']+)["']\s*;?/gm;

function extractValueImportSpecs(content: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content))) {
    const clause = m[1];
    const spec = m[2];
    if (isTypeOnlyClause(clause)) continue;
    specs.push(spec);
  }
  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  while ((m = SIDE_EFFECT_IMPORT_RE.exec(content))) {
    specs.push(m[1]);
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Path alias resolution -- a textual copy of tsconfig.json's own `paths`
// table, most-specific prefix first (matching how the real TS resolver
// picks among overlapping `@/...` mappings).
// ---------------------------------------------------------------------------

const ALIASES: Array<{ prefix: string; target: string }> = [
  { prefix: "@/lib/", target: "lib/" },
  { prefix: "@/components/", target: "components/" },
  { prefix: "@/hooks/", target: "hooks/" },
  { prefix: "@/projects/", target: "app/[locale]/projects/" },
  { prefix: "@/admin/", target: "app/[locale]/admin/" },
  { prefix: "@/sessions/", target: "app/[locale]/projects/sessions/" },
  { prefix: "@/milestones/", target: "app/[locale]/projects/milestones/" },
  { prefix: "@/types/", target: "types/" },
  { prefix: "@/utils/", target: "utils/" },
  { prefix: "@/", target: "app/" }, // general fallback -- checked last among "@/" prefixes
  { prefix: "~/", target: "" },
];

function resolveFileCandidate(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) {
      return path.relative(ROOT, c);
    }
  }
  return null;
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (spec === "@/constants") {
    return resolveFileCandidate(path.join(ROOT, "app/constants/index.ts"));
  }
  for (const { prefix, target } of ALIASES) {
    if (spec.startsWith(prefix)) {
      return resolveFileCandidate(
        path.join(ROOT, target, spec.slice(prefix.length))
      );
    }
  }
  if (spec.startsWith(".")) {
    const base = path.dirname(path.join(ROOT, fromFile));
    return resolveFileCandidate(path.join(base, spec));
  }
  return null; // bare package specifier -- not walked further
}

// ---------------------------------------------------------------------------
// Server-only markers
// ---------------------------------------------------------------------------

const SERVER_ONLY_PACKAGES = ["kysely", "bullmq", "ioredis"];
function isServerOnlyPackage(spec: string): boolean {
  return SERVER_ONLY_PACKAGES.some(
    (pkg) => spec === pkg || spec.startsWith(`${pkg}/`)
  );
}

// Matched against the RESOLVED file path, relative to ROOT -- see the header
// comment for why "lib/prisma.ts" is permanently inert (verified absent).
const SERVER_ONLY_FILES = new Set([
  "lib/db.ts",
  "lib/prisma.ts",
  "lib/zenstack.ts",
  "server/db.ts",
]);

interface ServerReachResult {
  hit: string;
  chain: string[];
}

function findServerReach(entryFile: string): ServerReachResult | null {
  const visited = new Set<string>();
  const stack: Array<{ file: string; chain: string[] }> = [
    { file: entryFile, chain: [entryFile] },
  ];
  let isEntry = true;
  while (stack.length > 0) {
    const { file, chain } = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    let content: string;
    try {
      content = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    // A "use server" Server Action module is Next.js's own inverse boundary:
    // do not recurse into ITS imports (never applies to the entry file
    // itself, which is always a plain hook/"use client" component, never a
    // Server Action).
    if (!isEntry && hasDirective(content, "use server")) {
      continue;
    }
    isEntry = false;
    const specs = extractValueImportSpecs(content);
    for (const spec of specs) {
      const resolved = resolveImport(file, spec);
      if (resolved === null) {
        if (isServerOnlyPackage(spec)) {
          return { hit: spec, chain: [...chain, spec] };
        }
        continue; // an unresolvable, non-server-only bare package -- a leaf
      }
      if (SERVER_ONLY_FILES.has(resolved)) {
        return { hit: resolved, chain: [...chain, resolved] };
      }
      if (!visited.has(resolved)) {
        stack.push({ file: resolved, chain: [...chain, resolved] });
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Client/server bundle boundary containment (structural)", () => {
  it("the scope resolves to a non-trivial, expected file set", () => {
    const scope = resolveScope();
    // A floor, not an exact count (matching this file family's own
    // "minimum, not exact" convention) -- this only fails if the scope
    // resolution itself regresses to near-zero (e.g. a glob pattern typo),
    // not on a legitimate file being added or removed.
    expect(scope.length).toBeGreaterThanOrEqual(60);
    expect(scope).toContain("hooks/useRequirementsTree.ts");
    expect(scope).toContain(
      "app/[locale]/projects/requirements/[projectId]/RequirementsListView.tsx"
    );
    // requirementsListRows.ts carries no "use client" directive of its own
    // (an isomorphic shared module, importable server-side too, per 28-10)
    // -- it must NOT be a scope ENTRY, even though it is still reachable
    // (and walked) from RequirementsListView.tsx's own chain.
    expect(scope).not.toContain(
      "app/[locale]/projects/requirements/[projectId]/requirementsListRows.ts"
    );
  });

  it("no hooks/ or requirements-surface client module transitively reaches the database/queue layer via a value import", () => {
    const scope = resolveScope();
    const violations = scope
      .map((file) => ({ file, result: findServerReach(file) }))
      .filter((v): v is { file: string; result: ServerReachResult } =>
        Boolean(v.result)
      );

    if (violations.length > 0) {
      const message = violations
        .map(
          (v) =>
            `${v.file} reaches "${v.result.hit}" via: ${v.result.chain.join(" -> ")}`
        )
        .join("\n");
      throw new Error(
        `Found ${violations.length} client module(s) that transitively reach the database/queue layer via a VALUE import (never a type-only one):\n${message}\n\n` +
          "This is the exact class of bug fixed in 97824fde4: a value import of a " +
          "server-only-reaching module pulls the database layer into the client " +
          "bundle, which the bundler cannot build. Change the import to `import type` " +
          "(if only types are needed), or move the value usage behind a route/Server " +
          "Action boundary."
      );
    }
    expect(violations).toEqual([]);
  });

  it("hooks/useRequirementsTree.ts's own value imports stay clean -- only its type-only import reaches requirementTree.ts", () => {
    // Pins the specific, real-world case this gate was built for: the file
    // must resolve completely clean today (its requirementTree.ts import is
    // `import type`, erased at compile time), which the mutation-prove test
    // below temporarily breaks and reverts.
    const result = findServerReach("hooks/useRequirementsTree.ts");
    expect(result).toBeNull();
  });

  it("does not recurse past a 'use server' Server Action boundary (no false positive on a real, shipped chain)", () => {
    // hooks/useAccessibleProjectsForUsers.ts -> app/actions/getUserAccessibleProjects.ts
    // (a real "use server" file) -> ~/lib/db. If this gate ever stopped
    // respecting the "use server" boundary, this exact, already-shipped
    // hook would start failing the main containment test above for no
    // actual bundling reason -- teaching the next reader to distrust (or
    // weaken) the gate rather than fix a real bug.
    const actionFile = "app/actions/getUserAccessibleProjects.ts";
    const actionContent = readFileSync(path.join(ROOT, actionFile), "utf8");
    expect(hasDirective(actionContent, "use server")).toBe(true);
    expect(actionContent).toContain('from "~/lib/db"');

    const result = findServerReach("hooks/useAccessibleProjectsForUsers.ts");
    expect(result).toBeNull();
  });

  describe("extractValueImportSpecs (parser self-test, literal fixtures)", () => {
    it("recognizes a plain type-only default import as carrying no value", () => {
      expect(
        extractValueImportSpecs('import type Foo from "some-module";')
      ).toEqual([]);
    });

    it("recognizes a braced type-only import as carrying no value", () => {
      expect(
        extractValueImportSpecs('import type { Foo, Bar } from "some-module";')
      ).toEqual([]);
    });

    it("recognizes every-binding-prefixed-`type` braces as carrying no value", () => {
      expect(
        extractValueImportSpecs(
          'import { type Foo, type Bar } from "some-module";'
        )
      ).toEqual([]);
    });

    it("recognizes a mix of type and value bindings in one brace as a real value import", () => {
      expect(
        extractValueImportSpecs('import { type Foo, bar } from "some-module";')
      ).toEqual(["some-module"]);
    });

    it("recognizes a plain named import as a value import", () => {
      expect(
        extractValueImportSpecs('import { Foo } from "some-module";')
      ).toEqual(["some-module"]);
    });

    it("recognizes a default import as a value import", () => {
      expect(extractValueImportSpecs('import Foo from "some-module";')).toEqual(
        ["some-module"]
      );
    });

    it("recognizes a default import alongside type-only braces as a real value import", () => {
      expect(
        extractValueImportSpecs('import Foo, { type Bar } from "some-module";')
      ).toEqual(["some-module"]);
    });

    it("recognizes a namespace import as a value import", () => {
      expect(
        extractValueImportSpecs('import * as Foo from "some-module";')
      ).toEqual(["some-module"]);
    });

    it("recognizes a side-effect-only import as a value import", () => {
      expect(extractValueImportSpecs('import "some-module";')).toEqual([
        "some-module",
      ]);
    });

    it("recognizes a value re-export as a value import", () => {
      expect(
        extractValueImportSpecs('export { Foo } from "some-module";')
      ).toEqual(["some-module"]);
    });

    it("recognizes a type-only re-export as carrying no value", () => {
      expect(
        extractValueImportSpecs('export type { Foo } from "some-module";')
      ).toEqual([]);
    });

    it("recognizes a wildcard re-export as a value import (conservatively -- could re-export values)", () => {
      expect(extractValueImportSpecs('export * from "some-module";')).toEqual([
        "some-module",
      ]);
    });

    it("recognizes a type-only wildcard re-export as carrying no value", () => {
      expect(
        extractValueImportSpecs('export type * from "some-module";')
      ).toEqual([]);
    });
  });
});
