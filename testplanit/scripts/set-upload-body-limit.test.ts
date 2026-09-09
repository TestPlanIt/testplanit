import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  BODY_LIMIT_HEADROOM_MB,
  FROZEN_CONFIG_FILES,
  bodySizeLimitFor,
  parseUploadMaxMb,
  replaceBodySizeLimit,
  syncBodySizeLimit,
} from "./set-upload-body-limit";

// Shaped like the real standalone output: server.js carries the config inlined
// as a JSON literal, required-server-files.json as compact JSON.
const serverJs = (limit: string) =>
  `const currentPort = parseInt(process.env.PORT, 10) || 3000\n` +
  `const nextConfig = {"env":{},"experimental":{"serverActions":{"bodySizeLimit":"${limit}"}},"images":{"unoptimized":true}}\n` +
  `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)\n`;

const requiredServerFiles = (limit: string) =>
  JSON.stringify({
    version: 1,
    config: {
      images: { unoptimized: true },
      experimental: { serverActions: { bodySizeLimit: limit } },
    },
    files: ["server.js"],
  });

function writeStandalone(limit: string): string {
  const dir = mkdtempSync(join(tmpdir(), "standalone-"));
  mkdirSync(join(dir, ".next"));
  writeFileSync(join(dir, "server.js"), serverJs(limit));
  writeFileSync(
    join(dir, ".next", "required-server-files.json"),
    requiredServerFiles(limit)
  );
  return dir;
}

const limitsIn = (dir: string) =>
  FROZEN_CONFIG_FILES.map(
    (f) =>
      readFileSync(join(dir, f), "utf-8").match(
        /"bodySizeLimit":"([^"]*)"/
      )?.[1]
  );

describe("set-upload-body-limit", () => {
  it("keeps the headroom next.config.ts adds for multipart overhead", () => {
    expect(bodySizeLimitFor(100)).toBe(`${100 + BODY_LIMIT_HEADROOM_MB}mb`);
    // Guards against the two drifting apart: next.config.ts sizes the build-time
    // default with the same headroom this script re-applies at boot.
    const nextConfig = readFileSync(
      join(__dirname, "..", "next.config.ts"),
      "utf-8"
    );
    expect(nextConfig).toContain(
      `\${uploadMaxMb + ${BODY_LIMIT_HEADROOM_MB}}mb`
    );
  });

  it.each(["", undefined, "0", "-5", "abc"])(
    "leaves the baked limit alone when UPLOAD_MAX_MB is %o",
    (raw) => {
      expect(parseUploadMaxMb(raw)).toBeNull();
      const dir = writeStandalone("20mb");
      expect(syncBodySizeLimit(dir, raw)).toBeNull();
      expect(limitsIn(dir)).toEqual(["20mb", "20mb"]);
    }
  );

  it("raises both frozen copies to match UPLOAD_MAX_MB", () => {
    const dir = writeStandalone("20mb");
    expect(syncBodySizeLimit(dir, "100")).toEqual([
      {
        file: join(dir, "server.js"),
        status: "updated",
        from: "20mb",
        to: "110mb",
      },
      {
        file: join(dir, ".next/required-server-files.json"),
        status: "updated",
        from: "20mb",
        to: "110mb",
      },
    ]);
    expect(limitsIn(dir)).toEqual(["110mb", "110mb"]);
  });

  // Authoritative in both directions, so an image built for a large ceiling
  // cannot keep accepting oversized bodies after the operator lowers the knob.
  it("lowers both frozen copies too", () => {
    const dir = writeStandalone("110mb");
    syncBodySizeLimit(dir, "10");
    expect(limitsIn(dir)).toEqual(["20mb", "20mb"]);
  });

  it("matches the spaced spelling required-server-files.json uses", () => {
    const spaced = '{"serverActions": {"bodySizeLimit": "20mb"}}';
    const { text, from, occurrences } = replaceBodySizeLimit(spaced, "110mb");
    expect({ from, occurrences }).toEqual({ from: "20mb", occurrences: 1 });
    expect(text).toBe('{"serverActions": {"bodySizeLimit": "110mb"}}');
  });

  it("changes nothing but the limit", () => {
    const before = serverJs("20mb");
    const { text, from, occurrences } = replaceBodySizeLimit(before, "110mb");
    expect({ from, occurrences }).toEqual({ from: "20mb", occurrences: 1 });
    expect(text).toBe(before.replace('"20mb"', '"110mb"'));
    // images.unoptimized is the other build-frozen value the self-host image
    // depends on -- rewriting must not disturb it.
    expect(text).toContain('"images":{"unoptimized":true}');
  });

  it("is a no-op when the limit already matches", () => {
    const dir = writeStandalone("110mb");
    expect(syncBodySizeLimit(dir, "100")?.map((r) => r.status)).toEqual([
      "unchanged",
      "unchanged",
    ]);
  });

  // The workers image has no standalone tree; boot must not fail there.
  it("reports missing files instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-"));
    expect(syncBodySizeLimit(dir, "100")?.map((r) => r.status)).toEqual([
      "missing",
      "missing",
    ]);
  });

  it("leaves a build that never set the key alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "no-key-"));
    mkdirSync(join(dir, ".next"));
    writeFileSync(join(dir, "server.js"), "const nextConfig = {}\n");
    writeFileSync(join(dir, ".next", "required-server-files.json"), "{}");
    expect(syncBodySizeLimit(dir, "100")?.map((r) => r.status)).toEqual([
      "no-match",
      "no-match",
    ]);
    expect(readFileSync(join(dir, "server.js"), "utf-8")).toBe(
      "const nextConfig = {}\n"
    );
  });
});
