/**
 * Normalize an automated test name before it becomes test-case identity.
 *
 * Some frameworks embed a non-deterministic object hash in the test name.
 * TestNG's parameterized names include the runner's `identityHashCode`, e.g.
 *
 *   testCompareCompanyReportObjectsNotEqual[0](org.testng.TestRunner@41738d)
 *
 * The `@41738d` is a per-process memory address, regenerated on every run — so
 * without stripping it, each CI execution imports the *same* test under a new
 * name and the `(projectId, name, className)` unique key never matches, piling
 * up one duplicate case per run (this produced ~33k duplicate cases in one
 * imported project).
 *
 * We strip any parenthesized `(<optional dotted class>@<hex>)` object-hash
 * suffix. The `[0]` invocation index is deliberately PRESERVED: for genuine
 * multi-parameter tests `[0]`/`[1]`/`[2]` are distinct invocations that must
 * remain distinct cases.
 */
const OBJECT_HASH = /\s*\((?:[\w.$]+)?@[0-9a-f]+\)/g;

export const stripEphemeralHash = (name: string | null | undefined): string =>
  (name ?? "").replace(OBJECT_HASH, "").trim();
