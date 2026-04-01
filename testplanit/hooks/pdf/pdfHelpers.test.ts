import { describe, expect, it } from "vitest";
import { sanitizeTextForPdf, isEmbeddableImage } from "./pdfHelpers";

describe("pdfHelpers", () => {
  describe("sanitizeTextForPdf", () => {
    it("replaces narrow no-break space with regular space", () => {
      expect(sanitizeTextForPdf("hello\u202Fworld")).toBe("hello world");
    });

    it("replaces non-breaking space with regular space", () => {
      expect(sanitizeTextForPdf("hello\u00A0world")).toBe("hello world");
    });

    it("removes zero-width space", () => {
      expect(sanitizeTextForPdf("hello\u200Bworld")).toBe("helloworld");
    });

    it("removes word joiner", () => {
      expect(sanitizeTextForPdf("hello\u2060world")).toBe("helloworld");
    });

    it("handles multiple problematic characters in one string", () => {
      expect(
        sanitizeTextForPdf("a\u202Fb\u00A0c\u200Bd\u2060e")
      ).toBe("a b cde");
    });

    it("returns empty string for empty input", () => {
      expect(sanitizeTextForPdf("")).toBe("");
    });

    it("returns falsy value unchanged", () => {
      expect(sanitizeTextForPdf(null as any)).toBe(null);
      expect(sanitizeTextForPdf(undefined as any)).toBe(undefined);
    });

    it("leaves normal text unchanged", () => {
      expect(sanitizeTextForPdf("Hello World 123")).toBe("Hello World 123");
    });
  });

  describe("isEmbeddableImage", () => {
    it("returns true for JPEG", () => {
      expect(isEmbeddableImage("image/jpeg")).toBe(true);
    });

    it("returns true for PNG", () => {
      expect(isEmbeddableImage("image/png")).toBe(true);
    });

    it("returns true for GIF", () => {
      expect(isEmbeddableImage("image/gif")).toBe(true);
    });

    it("returns true for WebP", () => {
      expect(isEmbeddableImage("image/webp")).toBe(true);
    });

    it("returns true for BMP", () => {
      expect(isEmbeddableImage("image/bmp")).toBe(true);
    });

    it("returns false for PDF", () => {
      expect(isEmbeddableImage("application/pdf")).toBe(false);
    });

    it("returns false for SVG", () => {
      expect(isEmbeddableImage("image/svg+xml")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isEmbeddableImage(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isEmbeddableImage(undefined)).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isEmbeddableImage("IMAGE/JPEG")).toBe(true);
      expect(isEmbeddableImage("Image/Png")).toBe(true);
    });
  });
});
