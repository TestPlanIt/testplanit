/**
 * Sync Next's frozen server-action body limit with UPLOAD_MAX_MB at boot.
 *
 * next.config.ts sizes experimental.serverActions.bodySizeLimit from
 * UPLOAD_MAX_MB and `next build` freezes it into the standalone output, in two
 * places: inlined into the `nextConfig` literal in server.js (handed to the
 * server through __NEXT_PRIVATE_STANDALONE_CONFIG) and in
 * .next/required-server-files.json (read by the render worker). The running
 * server reads those frozen copies, never next.config.ts.
 *
 * So on an image the operator did not build -- the published self-host images,
 * the Helm chart -- the value baked at build time is the real ceiling: raising
 * UPLOAD_MAX_MB at runtime moves only app/actions/uploadFile.ts's own check, and
 * a file sized between the two limits is rejected by Next before the action
 * runs, with an opaque error instead of the friendly "File is too large".
 *
 * docker-entrypoint.sh runs this before starting the server so UPLOAD_MAX_MB is
 * the single knob it is documented to be, whoever built the image. It is
 * deliberately non-fatal: an unwritable file (read-only root filesystem) leaves
 * the baked default in place rather than blocking boot.
 */
import { readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

// Mirrors the headroom in next.config.ts. Server actions carry uploads as
// multipart FormData, so the transport limit has to sit above the per-file
// ceiling or encoding overhead turns "File is too large" into an opaque error.
export const BODY_LIMIT_HEADROOM_MB = 10;

// Both frozen copies, relative to the standalone app directory (the entrypoint
// runs from /app/testplanit, where server.js lives).
export const FROZEN_CONFIG_FILES = [
  "server.js",
  ".next/required-server-files.json",
];

// Narrow on purpose: server.js is generated JavaScript with the config inlined
// as a JSON literal, so a targeted key rewrite is safer than parsing it.
const LIMIT_PATTERN = /("bodySizeLimit"\s*:\s*")([^"]*)(")/g;

export type FileResult = {
  file: string;
  status: "updated" | "unchanged" | "missing" | "no-match" | "failed";
  from?: string;
  to?: string;
  error?: string;
};

/** Mirrors the parse in next.config.ts and app/actions/uploadFile.ts. */
export function parseUploadMaxMb(raw: string | undefined): number | null {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function bodySizeLimitFor(uploadMaxMb: number): string {
  return `${uploadMaxMb + BODY_LIMIT_HEADROOM_MB}mb`;
}

export function replaceBodySizeLimit(
  source: string,
  limit: string
): { text: string; from?: string; occurrences: number } {
  let occurrences = 0;
  let from: string | undefined;
  const text = source.replace(LIMIT_PATTERN, (_match, open, current, close) => {
    occurrences += 1;
    from ??= current;
    return `${open}${limit}${close}`;
  });
  return { text, from, occurrences };
}

function syncFile(filePath: string, limit: string): FileResult {
  const file = filePath;
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (error) {
    // Normal outside the production image: the workers image has no standalone
    // tree, and dev reads next.config.ts directly.
    const err = error as NodeJS.ErrnoException;
    return err.code === "ENOENT"
      ? { file, status: "missing" }
      : { file, status: "failed", error: err.message };
  }

  const { text, from, occurrences } = replaceBodySizeLimit(source, limit);
  if (occurrences === 0) {
    // A build that never set serverActions.bodySizeLimit. Nothing to keep in
    // step, and inserting the key into generated output is not worth the risk.
    return { file, status: "no-match" };
  }
  if (text === source) {
    return { file, status: "unchanged", from, to: limit };
  }

  // Write-and-rename: a container killed mid-write must never leave the server
  // with a truncated server.js.
  const tmpPath = `${filePath}.tmp`;
  try {
    writeFileSync(tmpPath, text, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (error) {
    return { file, status: "failed", error: (error as Error).message };
  }
  return { file, status: "updated", from, to: limit };
}

/**
 * Rewrite every frozen copy under `rootDir` to match `rawUploadMaxMb`.
 * Authoritative in both directions, so an image built for a large ceiling
 * cannot keep accepting oversized bodies after the operator lowers the knob.
 * Unset or invalid leaves the build-time value in place.
 */
export function syncBodySizeLimit(
  rootDir: string,
  rawUploadMaxMb: string | undefined
): FileResult[] | null {
  const uploadMaxMb = parseUploadMaxMb(rawUploadMaxMb);
  if (uploadMaxMb === null) {
    return null;
  }
  const limit = bodySizeLimitFor(uploadMaxMb);
  return FROZEN_CONFIG_FILES.map((relative) =>
    syncFile(join(rootDir, relative), limit)
  );
}

export function main(): void {
  const results = syncBodySizeLimit(process.cwd(), process.env.UPLOAD_MAX_MB);
  if (results === null) {
    return;
  }
  for (const result of results) {
    if (result.status === "updated") {
      console.log(
        `Server-action body limit in ${result.file}: ${result.from} -> ${result.to} (UPLOAD_MAX_MB=${process.env.UPLOAD_MAX_MB})`
      );
    } else if (result.status === "failed") {
      console.warn(
        `Server-action body limit in ${result.file}: left as built (${result.error}).`
      );
    }
  }
}

// tsx runs this file directly from docker-entrypoint.sh; the test imports the
// functions above without triggering the CLI.
if (require.main === module) {
  main();
}
