import { describe, expect, it } from "vitest";
import { fileFormatName } from "./adminAttachmentRules";

describe("fileFormatName", () => {
  it("names a format by its subtype", () => {
    expect(fileFormatName("image/png")).toBe("PNG");
    expect(fileFormatName("application/pdf")).toBe("PDF");
    expect(fileFormatName("video/mp4")).toBe("MP4");
  });

  it("drops vendor prefixes, structured suffixes and parameters", () => {
    expect(fileFormatName("audio/x-m4a")).toBe("M4A");
    expect(fileFormatName("image/svg+xml")).toBe("SVG");
    expect(fileFormatName("text/csv; charset=utf-8")).toBe("CSV");
  });

  it("uses the familiar name where the mime type hides it", () => {
    expect(
      fileFormatName(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("DOCX");
    expect(fileFormatName("application/msword")).toBe("DOC");
    expect(fileFormatName("text/plain")).toBe("TXT");
    expect(fileFormatName("TEXT/Markdown")).toBe("MD");
  });

  it("has nothing to say about a missing type", () => {
    expect(fileFormatName("")).toBe("");
    expect(fileFormatName("  ")).toBe("");
  });
});
