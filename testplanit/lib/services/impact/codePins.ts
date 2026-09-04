import { createHash } from "crypto";
import { z } from "zod/v4";
import type { GitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { resolveRefToSha } from "./compareService";
import { getFileAtCommit, isSafeRepoPath } from "./fileAtCommit";
import { locateSnippet, locateSymbolBlock } from "./pinMatcher";
import type { LoadedRepoConfig } from "./repoAccess";

export const CODE_PIN_KINDS = ["FILE", "RANGE", "SYMBOL", "GLOB"] as const;
export type CodePinKind = (typeof CODE_PIN_KINDS)[number];

/** Largest line span a RANGE pin may cover. */
export const MAX_PIN_RANGE_LINES = 500;
export const MAX_ANCHOR_SNIPPET_BYTES = 32 * 1024;
/** Pins per request for which staleness is computed live. */
export const MAX_STALENESS_CHECKS = 40;

export const codePinCreateSchema = z
  .object({
    configId: z.number().int().positive(),
    kind: z.enum(CODE_PIN_KINDS),
    filePath: z.string().min(1).max(4096),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    symbol: z.string().trim().min(1).max(200).optional(),
    note: z.string().max(2000).optional(),
    ref: z.string().trim().min(1).max(255).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "GLOB" && !isSafeRepoPath(value.filePath)) {
      ctx.addIssue({
        code: "custom",
        path: ["filePath"],
        message: "Invalid path",
      });
    }
    if (value.kind === "RANGE") {
      if (value.startLine === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["startLine"],
          message: "Required",
        });
      } else {
        const end = value.endLine ?? value.startLine;
        if (end < value.startLine) {
          ctx.addIssue({
            code: "custom",
            path: ["endLine"],
            message: "Before start",
          });
        } else if (end - value.startLine + 1 > MAX_PIN_RANGE_LINES) {
          ctx.addIssue({
            code: "custom",
            path: ["endLine"],
            message: "Range too large",
          });
        }
      }
    }
    if (value.kind === "SYMBOL" && !value.symbol) {
      ctx.addIssue({ code: "custom", path: ["symbol"], message: "Required" });
    }
  });

export type CodePinCreateInput = z.infer<typeof codePinCreateSchema>;

/**
 * Fields an existing pin may change: what it points at within the file it
 * already names, and the note.
 *
 * Kind and file are absent on purpose. Changing either makes the pin a
 * different claim about what the case covers, and analyses already recorded
 * against its id would then describe code the pin no longer points at. A
 * GLOB pin is the one exception, because its pattern lives in `filePath` and
 * is the only thing it points at.
 */
export const codePinUpdateSchema = z
  .object({
    filePath: z.string().trim().min(1).max(4096).optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    symbol: z.string().trim().min(1).max(200).optional(),
    note: z.string().max(2000).nullable().optional(),
    ref: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startLine !== undefined) {
      const end = value.endLine ?? value.startLine;
      if (end < value.startLine) {
        ctx.addIssue({
          code: "custom",
          path: ["endLine"],
          message: "Before start",
        });
      } else if (end - value.startLine + 1 > MAX_PIN_RANGE_LINES) {
        ctx.addIssue({
          code: "custom",
          path: ["endLine"],
          message: "Range too large",
        });
      }
    }
  });

export type CodePinUpdateInput = z.infer<typeof codePinUpdateSchema>;

/** Fields each kind may change; anything else in the patch is a 400. */
const EDITABLE_FIELDS: Record<CodePinKind, ReadonlySet<string>> = {
  FILE: new Set(["note", "ref"]),
  RANGE: new Set(["startLine", "endLine", "note", "ref"]),
  SYMBOL: new Set(["symbol", "note", "ref"]),
  GLOB: new Set(["filePath", "note"]),
};

/** The patch keys this kind does not accept, empty when the patch is valid. */
export function rejectedPinUpdateFields(
  kind: CodePinKind,
  patch: CodePinUpdateInput
): string[] {
  const allowed = EDITABLE_FIELDS[kind];
  return Object.keys(patch).filter(
    (key) =>
      patch[key as keyof CodePinUpdateInput] !== undefined && !allowed.has(key)
  );
}

/** Whether the patch moves what the pin points at, rather than just its note. */
export function pinUpdateMovesAnchor(patch: CodePinUpdateInput): boolean {
  return (
    patch.filePath !== undefined ||
    patch.startLine !== undefined ||
    patch.endLine !== undefined ||
    patch.symbol !== undefined
  );
}

export class PinAnchorError extends Error {
  constructor(
    public readonly code:
      | "file_not_found"
      | "line_out_of_range"
      | "symbol_not_found"
      | "snippet_too_large",
    message: string
  ) {
    super(message);
    this.name = "PinAnchorError";
  }
}

export interface PinAnchor {
  anchorSha: string | null;
  anchorSnippet: string | null;
  anchorHash: string | null;
  startLine: number | null;
  endLine: number | null;
}

function normalizeSnippet(snippet: string): string {
  return snippet
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n");
}

export function hashSnippet(snippet: string): string {
  return createHash("sha1").update(normalizeSnippet(snippet)).digest("hex");
}

async function readFileForAnchor(
  config: LoadedRepoConfig,
  adapter: GitRepoAdapter,
  path: string,
  sha: string
): Promise<string[]> {
  try {
    const { content } = await getFileAtCommit({
      configId: config.id,
      cacheEnabled: config.cacheEnabled,
      adapter,
      path,
      sha,
    });
    return content.split("\n");
  } catch (error) {
    if (error instanceof Error && /\b404\b|not found/i.test(error.message)) {
      throw new PinAnchorError("file_not_found", `File not found: ${path}`);
    }
    throw error;
  }
}

/**
 * Compute the anchor for a pin at the given ref (default: the config's
 * branch). RANGE pins store the exact lines; SYMBOL pins locate the block
 * and store its declaration line; FILE pins hash the whole file; GLOB pins
 * have no anchor.
 */
export async function anchorPin(
  config: LoadedRepoConfig,
  adapter: GitRepoAdapter,
  input: {
    kind: CodePinKind;
    filePath: string;
    startLine?: number | null;
    endLine?: number | null;
    symbol?: string | null;
    ref?: string | null;
  }
): Promise<PinAnchor> {
  if (input.kind === "GLOB") {
    return {
      anchorSha: null,
      anchorSnippet: null,
      anchorHash: null,
      startLine: null,
      endLine: null,
    };
  }

  const ref = input.ref ?? config.branch ?? (await adapter.getDefaultBranch());
  const sha = await resolveRefToSha(adapter, ref);
  const lines = await readFileForAnchor(config, adapter, input.filePath, sha);

  if (input.kind === "FILE") {
    return {
      anchorSha: sha,
      anchorSnippet: null,
      anchorHash: hashSnippet(lines.join("\n")),
      startLine: null,
      endLine: null,
    };
  }

  let startLine: number;
  let endLine: number;
  if (input.kind === "RANGE") {
    startLine = input.startLine ?? 1;
    endLine = input.endLine ?? startLine;
    if (endLine > lines.length) {
      throw new PinAnchorError(
        "line_out_of_range",
        `File has ${lines.length} lines`
      );
    }
  } else {
    const block = locateSymbolBlock(lines, input.symbol ?? "");
    if (!block) {
      throw new PinAnchorError(
        "symbol_not_found",
        `Symbol not found: ${input.symbol}`
      );
    }
    [startLine, endLine] = block;
  }

  const snippet = lines.slice(startLine - 1, endLine).join("\n");
  if (Buffer.byteLength(snippet) > MAX_ANCHOR_SNIPPET_BYTES) {
    throw new PinAnchorError("snippet_too_large", "Pinned block is too large");
  }
  return {
    anchorSha: sha,
    anchorSnippet: snippet,
    anchorHash: hashSnippet(snippet),
    startLine,
    endLine,
  };
}

export type PinStaleReason =
  "FILE_DELETED" | "SNIPPET_NOT_FOUND" | "SYMBOL_NOT_FOUND";

export interface PinStaleness {
  stale: boolean;
  staleReason?: PinStaleReason;
  staleDismissed: boolean;
  /** Where the anchored block currently sits, when it could be relocated. */
  currentRange?: [number, number];
  checkedSha: string;
}

export interface StalenessPinInput {
  id: number;
  kind: CodePinKind;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  anchorSha: string | null;
  anchorSnippet: string | null;
  staleDismissedAt: Date | string | null;
}

/**
 * Staleness of pins against the branch tip. Computed on read, never stored;
 * a pin anchored at the tip is fresh by definition. Provider failures leave
 * the pin unmarked rather than failing the whole read.
 */
export async function computePinStaleness(
  config: LoadedRepoConfig,
  adapter: GitRepoAdapter,
  pins: StalenessPinInput[]
): Promise<Map<number, PinStaleness>> {
  const out = new Map<number, PinStaleness>();
  if (pins.length === 0) return out;

  const ref = config.branch ?? (await adapter.getDefaultBranch());
  const tipSha = await resolveRefToSha(adapter, ref);
  const fileCache = new Map<string, Promise<string[] | null>>();
  const readTip = (path: string) => {
    let pending = fileCache.get(path);
    if (!pending) {
      pending = readFileForAnchor(config, adapter, path, tipSha).catch(
        (error) => {
          if (error instanceof PinAnchorError) return null;
          throw error;
        }
      );
      fileCache.set(path, pending);
    }
    return pending;
  };

  let checked = 0;
  for (const pin of pins) {
    const dismissed = pin.staleDismissedAt != null;
    const fresh: PinStaleness = {
      stale: false,
      staleDismissed: false,
      checkedSha: tipSha,
    };
    if (pin.kind === "GLOB" || pin.anchorSha === tipSha) {
      out.set(pin.id, fresh);
      continue;
    }
    if (checked >= MAX_STALENESS_CHECKS) continue;
    checked++;

    let lines: string[] | null;
    try {
      lines = await readTip(pin.filePath);
    } catch {
      continue;
    }
    if (lines === null) {
      out.set(pin.id, {
        stale: true,
        staleReason: "FILE_DELETED",
        staleDismissed: dismissed,
        checkedSha: tipSha,
      });
      continue;
    }
    if (pin.kind === "FILE") {
      out.set(pin.id, fresh);
      continue;
    }
    if (pin.kind === "RANGE") {
      const loc = locateSnippet(
        lines,
        (pin.anchorSnippet ?? "").split("\n"),
        pin.startLine ?? undefined
      );
      out.set(
        pin.id,
        loc
          ? { ...fresh, currentRange: [loc.start, loc.end] }
          : {
              stale: true,
              staleReason: "SNIPPET_NOT_FOUND",
              staleDismissed: dismissed,
              checkedSha: tipSha,
            }
      );
      continue;
    }
    const block = locateSymbolBlock(lines, pin.symbol ?? "");
    out.set(
      pin.id,
      block
        ? { ...fresh, currentRange: block }
        : {
            stale: true,
            staleReason: "SYMBOL_NOT_FOUND",
            staleDismissed: dismissed,
            checkedSha: tipSha,
          }
    );
  }
  return out;
}
