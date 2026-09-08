import { describe, expect, it } from "vitest";
import {
  contextImageTokens,
  IMAGE_TOKEN_ESTIMATE,
  isAllowedImageMime,
  MAX_CONTEXT_IMAGES,
  MAX_IMAGE_BYTES,
  sanitizeContextImages,
  toContextImageMeta,
  toImageParts,
  type ContextImage,
} from "./context-images";

const makeImage = (overrides: Partial<ContextImage> = {}): ContextImage => ({
  id: "jira-attachment:1",
  source: "jira-attachment",
  filename: "screen.png",
  mimeType: "image/png",
  base64: "iVBORw0KGgo=",
  byteSize: 1024,
  ...overrides,
});

describe("isAllowedImageMime", () => {
  it("accepts the allowlist case-insensitively and rejects the rest", () => {
    expect(isAllowedImageMime("image/png")).toBe(true);
    expect(isAllowedImageMime("IMAGE/JPEG")).toBe(true);
    expect(isAllowedImageMime("image/svg+xml")).toBe(false);
    expect(isAllowedImageMime("video/mp4")).toBe(false);
    expect(isAllowedImageMime(undefined)).toBe(false);
  });
});

describe("sanitizeContextImages", () => {
  it("applies type, size, and count caps in order with reasons", () => {
    const images = [
      makeImage({ id: "a", filename: "ok1.png" }),
      makeImage({ id: "b", filename: "vector.svg", mimeType: "image/svg+xml" }),
      makeImage({
        id: "c",
        filename: "huge.png",
        byteSize: MAX_IMAGE_BYTES + 1,
      }),
      ...Array.from({ length: MAX_CONTEXT_IMAGES }, (_, i) =>
        makeImage({ id: `d${i}`, filename: `ok${i + 2}.png` })
      ),
    ];

    const { included, skipped } = sanitizeContextImages(images);

    // ok1 + the first (MAX-1) of the trailing batch fit under the cap.
    expect(included).toHaveLength(MAX_CONTEXT_IMAGES);
    expect(included[0].filename).toBe("ok1.png");
    expect(skipped).toEqual([
      { filename: "vector.svg", reason: "unsupported-type" },
      { filename: "huge.png", reason: "too-large" },
      { filename: `ok${MAX_CONTEXT_IMAGES + 1}.png`, reason: "over-count" },
    ]);
  });

  it("passes an empty list through", () => {
    expect(sanitizeContextImages([])).toEqual({ included: [], skipped: [] });
  });
});

describe("toImageParts / toContextImageMeta", () => {
  it("maps to LlmImagePart shape", () => {
    expect(toImageParts([makeImage()])).toEqual([
      {
        type: "image",
        mimeType: "image/png",
        base64: "iVBORw0KGgo=",
        filename: "screen.png",
      },
    ]);
  });

  it("meta slice never contains base64", () => {
    const meta = toContextImageMeta([makeImage()]);
    expect(meta).toEqual([
      {
        id: "jira-attachment:1",
        source: "jira-attachment",
        filename: "screen.png",
        byteSize: 1024,
      },
    ]);
    expect(JSON.stringify(meta)).not.toContain("iVBOR");
  });
});

describe("contextImageTokens", () => {
  it("charges the flat per-image estimate", () => {
    expect(contextImageTokens([makeImage(), makeImage()])).toBe(
      2 * IMAGE_TOKEN_ESTIMATE
    );
  });
});
