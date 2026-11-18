import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * Behaviour hints attached to every tool, so a client can let reads through
 * and ask before a change. `openWorldHint` is false unless the tool reaches a
 * system outside TestPlanIt (an issue tracker, a CI provider, an LLM).
 */

/** Reads TestPlanIt data and changes nothing. */
export const READS: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

/** Adds new records and leaves existing ones as they were. */
export const ADDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

/** Adds records, and reads from or starts work in an external system. */
export const ADDS_EXTERNAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};

/** Overwrites or removes existing data. */
export const CHANGES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

/** Soft-deletes a record; repeating the call leaves it deleted. */
export const DELETES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
