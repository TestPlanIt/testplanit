/**
 * SOFT_DELETE_REGISTRY drift-by-omission guard.
 *
 * The `tpl_stamp_deleted_at_*` triggers stamp/clear `deletedAt` on the `isDeleted` flip, but only
 * for the tables in SOFT_DELETE_REGISTRY. A new soft-deletable model that adds `isDeleted` but is
 * forgotten here would silently never record a deletion time — its rows would be invisible to any
 * retention/purge job. This test fails the unit lane in that case instead of shipping the gap.
 *
 * The registry must equal, EXACTLY, the set of models declaring `isDeleted` in schema.zmodel, and
 * every such model must also declare `deletedAt` (the column the trigger writes). No DB needed —
 * this is a pure static-parity check on the schema source of truth.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SOFT_DELETE_REGISTRY } from "../trigger-registry";

const schema = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../schema.zmodel"),
  "utf8"
);

/**
 * Walk the schema line by line, tracking the current `model` block, and record which models declare
 * an `isDeleted` boolean and which declare a `deletedAt` field. A model's closing brace is at column
 * 0, so it reliably ends the block.
 */
function collectModelFields(): {
  withIsDeleted: Set<string>;
  withDeletedAt: Set<string>;
} {
  const withIsDeleted = new Set<string>();
  const withDeletedAt = new Set<string>();
  let current: string | null = null;
  for (const line of schema.split("\n")) {
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      current = modelMatch[1];
      continue;
    }
    if (line.startsWith("}")) {
      current = null;
      continue;
    }
    if (!current) continue;
    if (/^\s*isDeleted\s+Boolean\b/.test(line)) withIsDeleted.add(current);
    if (/^\s*deletedAt\s+DateTime\b/.test(line)) withDeletedAt.add(current);
  }
  return { withIsDeleted, withDeletedAt };
}

const { withIsDeleted, withDeletedAt } = collectModelFields();
const registryTables = SOFT_DELETE_REGISTRY.map((e) => e.table);

describe("SOFT_DELETE_REGISTRY parity with schema.zmodel", () => {
  it("has no duplicate table entries", () => {
    expect(new Set(registryTables).size).toBe(registryTables.length);
  });

  it("covers every model that declares isDeleted (no missing)", () => {
    const registrySet = new Set(registryTables);
    const missing = [...withIsDeleted].filter((m) => !registrySet.has(m));
    expect(missing).toEqual([]);
  });

  it("contains no table that lacks an isDeleted field (no extra)", () => {
    const extra = registryTables.filter((t) => !withIsDeleted.has(t));
    expect(extra).toEqual([]);
  });

  it("every registry table also declares the deletedAt column the trigger writes", () => {
    const withoutDeletedAt = registryTables.filter(
      (t) => !withDeletedAt.has(t)
    );
    expect(withoutDeletedAt).toEqual([]);
  });
});
