import { describe, expect, it } from "vitest";
import {
  contentImages,
  countImages,
  estimatePromptTokens,
  flattenToText,
  IMAGE_TOKEN_ESTIMATE,
  stripImages,
} from "./content";
import type { LlmContentPart, LlmMessage } from "./types";

const PNG = "iVBORw0KGgo=";

const mixed: LlmContentPart[] = [
  { type: "text", text: "Describe the screenshot." },
  { type: "image", mimeType: "image/png", base64: PNG, filename: "login.png" },
  { type: "text", text: "Focus on the form." },
];

describe("flattenToText", () => {
  it("passes plain strings through", () => {
    expect(flattenToText("hello")).toBe("hello");
  });

  it("joins text parts and renders image markers with filenames", () => {
    expect(flattenToText(mixed)).toBe(
      "Describe the screenshot.\n[image: login.png]\nFocus on the form."
    );
  });

  it("falls back to a generic marker without a filename", () => {
    expect(
      flattenToText([{ type: "image", mimeType: "image/png", base64: PNG }])
    ).toBe("[image: attached image]");
  });
});

describe("contentImages / countImages", () => {
  it("returns [] for string content", () => {
    expect(contentImages("text")).toEqual([]);
  });

  it("extracts only image parts", () => {
    const images = contentImages(mixed);
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe("login.png");
  });

  it("counts across a message list", () => {
    const messages: LlmMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: mixed },
      { role: "user", content: [...mixed, ...mixed] },
    ];
    expect(countImages(messages)).toBe(3);
  });
});

describe("stripImages", () => {
  it("flattens parts content and leaves string messages untouched (same reference)", () => {
    const stringMessage: LlmMessage = { role: "system", content: "sys" };
    const partsMessage: LlmMessage = { role: "user", content: mixed };
    const result = stripImages([stringMessage, partsMessage]);

    expect(result[0]).toBe(stringMessage);
    expect(result[1].content).toBe(
      "Describe the screenshot.\n[image: login.png]\nFocus on the form."
    );
    // Original message list is not mutated.
    expect(Array.isArray(partsMessage.content)).toBe(true);
  });
});

describe("estimatePromptTokens", () => {
  it("uses chars/4 for plain text", () => {
    const messages: LlmMessage[] = [{ role: "user", content: "a".repeat(400) }];
    expect(estimatePromptTokens(messages)).toBe(100);
  });

  it("adds a flat per-image charge on top of flattened text", () => {
    const messages: LlmMessage[] = [{ role: "user", content: mixed }];
    const flattenedLength = flattenToText(mixed).length;
    expect(estimatePromptTokens(messages)).toBe(
      Math.ceil(flattenedLength / 4) + IMAGE_TOKEN_ESTIMATE
    );
  });
});
