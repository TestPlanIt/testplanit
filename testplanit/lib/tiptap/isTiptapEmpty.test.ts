import { describe, expect, it } from "vitest";

import { isTiptapEmpty } from "./isTiptapEmpty";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });

describe("isTiptapEmpty", () => {
  it("treats null and undefined as empty", () => {
    expect(isTiptapEmpty(null)).toBe(true);
    expect(isTiptapEmpty(undefined)).toBe(true);
  });

  it("treats blank and whitespace-only strings as empty", () => {
    expect(isTiptapEmpty("")).toBe(true);
    expect(isTiptapEmpty("   \n\t ")).toBe(true);
  });

  it("treats a plain non-blank string as non-empty", () => {
    expect(isTiptapEmpty("overrode after re-run")).toBe(false);
  });

  it("treats the canonical empty doc as empty", () => {
    expect(isTiptapEmpty(doc(para()))).toBe(true);
  });

  it("treats multiple empty paragraphs as empty", () => {
    expect(isTiptapEmpty(doc(para(), para(), para()))).toBe(true);
  });

  it("treats a doc whose only text is whitespace as empty", () => {
    expect(isTiptapEmpty(doc(para(text("   "))))).toBe(true);
  });

  it("treats a doc with real text as non-empty", () => {
    expect(isTiptapEmpty(doc(para(text("Flaky retry"))))).toBe(false);
  });

  it("finds text nested in deeper structures", () => {
    expect(
      isTiptapEmpty(
        doc({
          type: "bulletList",
          content: [{ type: "listItem", content: [para(text("reason"))] }],
        })
      )
    ).toBe(false);
  });

  it("treats a media/atom-only doc as non-empty (image with no text)", () => {
    expect(isTiptapEmpty(doc({ type: "image", attrs: { src: "x.png" } }))).toBe(
      false
    );
  });

  it("treats a mention-only doc as non-empty", () => {
    expect(
      isTiptapEmpty(doc(para({ type: "mention", attrs: { id: "u1" } })))
    ).toBe(false);
  });

  it("ignores hard breaks as content", () => {
    expect(isTiptapEmpty(doc(para({ type: "hardBreak" })))).toBe(true);
  });

  it("parses a JSON-stringified doc", () => {
    expect(isTiptapEmpty(JSON.stringify(doc(para())))).toBe(true);
    expect(isTiptapEmpty(JSON.stringify(doc(para(text("hi")))))).toBe(false);
  });
});
