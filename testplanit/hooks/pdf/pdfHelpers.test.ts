import { describe, expect, it } from "vitest";
import {
  formatFieldValue,
  isEmbeddableImage,
  PdfRenderer,
  sanitizeTextForPdf,
} from "./pdfHelpers";

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
      expect(sanitizeTextForPdf("a\u202Fb\u00A0c\u200Bd\u2060e")).toBe(
        "a b cde"
      );
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

    it("transliterates smart quotes to straight quotes", () => {
      expect(sanitizeTextForPdf("“AI Avatar”")).toBe('"AI Avatar"');
      expect(sanitizeTextForPdf("it’s")).toBe("it's");
    });

    it("transliterates dashes and ellipsis to ASCII", () => {
      expect(sanitizeTextForPdf("Real-Time — AI…")).toBe("Real-Time - AI...");
      expect(sanitizeTextForPdf("a–b")).toBe("a-b");
    });

    it("replaces characters outside Latin-1 with a placeholder (no UTF-16 corruption)", () => {
      // Emoji and CJK have no glyph in the standard PDF fonts; without this
      // they trigger jsPDF's byte-interleaved UTF-16 fallback.
      expect(sanitizeTextForPdf("done 😀")).toBe("done ??");
      expect(sanitizeTextForPdf("测试")).toBe("??");
    });

    it("preserves accented Latin-1 characters", () => {
      expect(sanitizeTextForPdf("café ñoël")).toBe("café ñoël");
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

  describe("PdfRenderer text layout", () => {
    // Records each drawn string with the font active when it was drawn.
    const fakeDoc = () => {
      let font = { fontName: "helvetica", fontStyle: "normal" };
      const drawn: { text: string; font: string; y: number }[] = [];
      const doc = {
        internal: { pageSize: { width: 210, height: 297 } },
        setCharSpace: () => {},
        setFontSize: () => {},
        setTextColor: () => {},
        addPage: () => {},
        getFont: () => font,
        setFont: (fontName: string, fontStyle: string) => {
          font = { fontName, fontStyle };
        },
        getTextWidth: (text: string) => text.length * 2,
        splitTextToSize: (text: string) => [text],
        text: (text: string, _x: number, y: number) => {
          drawn.push({ text, font: `${font.fontName}/${font.fontStyle}`, y });
        },
      };
      return { doc, drawn };
    };

    it("draws each line of a step separately, bold number only, table rows in Courier", () => {
      const { doc, drawn } = fakeDoc();
      const pdf = new PdfRenderer(doc as any);
      pdf.renderStepHeading(1, "Given a rack\nExamples:\n| racks | x |");

      expect(drawn.map((d) => [d.text, d.font])).toEqual([
        ["1. ", "helvetica/bold"],
        ["Given a rack", "helvetica/normal"],
        ["Examples:", "helvetica/normal"],
        ["| racks | x |", "courier/normal"],
      ]);
      const ys = drawn.slice(1).map((d) => d.y);
      expect(new Set(ys).size).toBe(3);
      expect(doc.getFont()).toEqual({
        fontName: "helvetica",
        fontStyle: "normal",
      });
    });

    it("keeps line breaks in detail values and text blocks", () => {
      const { doc, drawn } = fakeDoc();
      const pdf = new PdfRenderer(doc as any);
      pdf.renderDetail("Expected", "Topology built\nNo errors");
      pdf.renderTextBlock("Description", "First\nSecond");

      expect(drawn.map((d) => d.text)).toEqual([
        "Expected: ",
        "Topology built",
        "No errors",
        "Description:",
        "First",
        "Second",
      ]);
    });
  });

  describe("formatFieldValue", () => {
    it("keeps paragraph breaks in Text Long values", () => {
      const value = JSON.stringify({
        type: "doc",
        content: ["one", "two"].map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      });
      expect(formatFieldValue(value, "Text Long")).toBe("one\ntwo");
      expect(formatFieldValue("plain", "Text Long")).toBe("plain");
    });
  });
});
