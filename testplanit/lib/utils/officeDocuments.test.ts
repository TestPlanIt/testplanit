import { describe, expect, it } from "vitest";

import { getOfficeKind, isOfficeDocument } from "./officeDocuments";

const WORD_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("getOfficeKind", () => {
  it("maps OOXML Word MIME to word", () => {
    expect(getOfficeKind(WORD_MIME, "report.docx")).toBe("word");
  });

  it("maps OOXML Excel MIME to excel", () => {
    expect(getOfficeKind(EXCEL_MIME, "data.xlsx")).toBe("excel");
  });

  it("maps OOXML PowerPoint MIME to powerpoint", () => {
    expect(getOfficeKind(PPTX_MIME, "deck.pptx")).toBe("powerpoint");
  });

  it("maps legacy .xls (application/vnd.ms-excel) to excel", () => {
    expect(getOfficeKind("application/vnd.ms-excel", "legacy.xls")).toBe(
      "excel"
    );
  });

  it("falls back to the filename extension when the MIME type is generic", () => {
    expect(getOfficeKind("application/octet-stream", "report.docx")).toBe(
      "word"
    );
    expect(getOfficeKind("application/zip", "data.xlsx")).toBe("excel");
    expect(getOfficeKind("", "slides.pptx")).toBe("powerpoint");
  });

  it("is case-insensitive on the extension", () => {
    expect(getOfficeKind(null, "REPORT.DOCX")).toBe("word");
  });

  it("returns null for legacy binary .doc and .ppt (no client-side renderer)", () => {
    expect(getOfficeKind("application/msword", "old.doc")).toBeNull();
    expect(
      getOfficeKind("application/vnd.ms-powerpoint", "old.ppt")
    ).toBeNull();
  });

  it("returns null for non-office types", () => {
    expect(getOfficeKind("application/pdf", "file.pdf")).toBeNull();
    expect(getOfficeKind("image/png", "photo.png")).toBeNull();
    expect(getOfficeKind(undefined, undefined)).toBeNull();
  });
});

describe("isOfficeDocument", () => {
  it("is true for previewable office documents", () => {
    expect(isOfficeDocument(WORD_MIME, "a.docx")).toBe(true);
    expect(isOfficeDocument(PPTX_MIME, "a.pptx")).toBe(true);
  });

  it("is false for legacy .doc/.ppt and non-office types", () => {
    expect(isOfficeDocument("application/msword", "a.doc")).toBe(false);
    expect(isOfficeDocument("text/plain", "a.txt")).toBe(false);
  });
});
