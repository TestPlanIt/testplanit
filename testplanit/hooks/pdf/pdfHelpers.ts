/**
 * Shared PDF rendering helpers used by all PDF export hooks.
 * Extracted from useExportData.ts to avoid duplication.
 */

import type { jsPDF } from "jspdf";
import { extractTextFromNode } from "../../utils/extractTextFromJson";

// Image MIME types that can be embedded in PDF
const EMBEDDABLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
];

export const isEmbeddableImage = (
  mimeType: string | null | undefined
): boolean => {
  if (!mimeType) return false;
  return EMBEDDABLE_IMAGE_TYPES.includes(mimeType.toLowerCase());
};

/** Sanitize text for PDF export by replacing problematic Unicode characters */
export const sanitizeTextForPdf = (text: string): string => {
  if (!text) return text;
  return text
    .replace(/\u202f/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\u2007/g, " ")
    .replace(/\u2008/g, " ")
    .replace(/\u2009/g, " ")
    .replace(/\u200a/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\u2060/g, "");
};

/** Load an image from URL and convert to data URL for PDF embedding */
export const loadImageAsDataUrl = (
  url: string,
  mimeType: string
): Promise<{ dataUrl: string; width: number; height: number } | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const outputFormat =
          mimeType === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(outputFormat, 0.85);
        resolve({
          dataUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);

    setTimeout(() => {
      if (!img.complete) resolve(null);
    }, 10000);

    img.src = url;
  });
};

export type LoadedImage = {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
};

/** Standard PDF document configuration */
export const PDF_CONFIG = {
  margin: 15,
  pageFormat: "a4" as const,
  orientation: "portrait" as const,
  maxImageWidth: 0, // calculated from content width
  maxImageHeight: 80,
  pixelsToMm: 0.264583,
};

/** Helper class wrapping jsPDF with common rendering operations */
export class PdfRenderer {
  doc: jsPDF;
  yPosition: number;
  margin: number;
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  maxImageWidth: number;
  maxImageHeight: number;

  constructor(doc: jsPDF) {
    this.doc = doc;
    this.margin = PDF_CONFIG.margin;
    this.pageWidth = doc.internal.pageSize.width;
    this.pageHeight = doc.internal.pageSize.height;
    this.contentWidth = this.pageWidth - 2 * this.margin;
    this.maxImageWidth = this.contentWidth - 10;
    this.maxImageHeight = PDF_CONFIG.maxImageHeight;
    this.yPosition = this.margin;
    doc.setCharSpace(0);
  }

  /** Check if we need a new page, add one if so */
  ensureSpace(needed: number) {
    if (this.yPosition > this.pageHeight - needed) {
      this.doc.addPage();
      this.yPosition = this.margin;
    }
  }

  /** Render a title (18pt bold) */
  renderTitle(text: string) {
    this.doc.setFontSize(18);
    this.doc.setFont("helvetica", "bold");
    this.doc.text(sanitizeTextForPdf(text), this.margin, this.yPosition);
    this.yPosition += 10;
  }

  /** Render subtitle metadata line (10pt normal) */
  renderMetaLine(left: string, right?: string) {
    this.doc.setFontSize(10);
    this.doc.setFont("helvetica", "normal");
    this.doc.text(sanitizeTextForPdf(left), this.margin, this.yPosition);
    if (right) {
      this.doc.text(
        sanitizeTextForPdf(right),
        this.margin + 80,
        this.yPosition
      );
    }
    this.yPosition += 6;
  }

  /** Render a section header (14pt bold) */
  renderSectionHeader(text: string) {
    this.ensureSpace(50);
    this.doc.setDrawColor(200, 200, 200);
    this.doc.line(
      this.margin,
      this.yPosition,
      this.pageWidth - this.margin,
      this.yPosition
    );
    this.yPosition += 8;
    this.doc.setFontSize(14);
    this.doc.setFont("helvetica", "bold");
    const lines: string[] = this.doc.splitTextToSize(
      sanitizeTextForPdf(text),
      this.contentWidth
    );
    lines.forEach((line: string) => {
      this.doc.text(line, this.margin, this.yPosition);
      this.yPosition += 6;
    });
    this.yPosition += 4;
    this.doc.setFontSize(10);
    this.doc.setFont("helvetica", "normal");
  }

  /** Render a sub-header (12pt bold) */
  renderSubHeader(text: string) {
    this.ensureSpace(30);
    this.doc.setFontSize(10);
    this.doc.setFont("helvetica", "bold");
    const lines: string[] = this.doc.splitTextToSize(
      sanitizeTextForPdf(text),
      this.contentWidth
    );
    // Limit to 2 lines max, truncate with ellipsis if longer
    const maxLines = 2;
    if (lines.length > maxLines) {
      lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*$/, "...");
      lines.length = maxLines;
    }
    lines.forEach((line: string) => {
      this.doc.text(line, this.margin, this.yPosition);
      this.yPosition += 5;
    });
    this.doc.setFont("helvetica", "normal");
  }

  /** Render a labeled field (bold label + normal value) */
  renderField(label: string, value: string | null | undefined) {
    if (!value || value.trim() === "") return;

    this.ensureSpace(30);
    this.doc.setFont("helvetica", "bold");
    this.doc.text(`${label}:`, this.margin, this.yPosition);
    this.doc.setFont("helvetica", "normal");

    const displayValue = sanitizeTextForPdf(String(value));
    const lines: string[] = this.doc.splitTextToSize(
      displayValue,
      this.contentWidth - 5
    );

    if (lines.length > 1 || displayValue.length > 60) {
      this.yPosition += 5;
      lines.forEach((line: string) => {
        this.ensureSpace(10);
        this.doc.text(String(line), this.margin + 5, this.yPosition);
        this.yPosition += 5;
      });
    } else {
      this.doc.text(String(lines[0] || ""), this.margin + 45, this.yPosition);
      this.yPosition += 6;
    }
  }

  /** Render a multi-line text block (for descriptions, notes, missions) */
  renderTextBlock(label: string, text: string | null | undefined) {
    if (!text || text.trim() === "") return;

    this.ensureSpace(20);
    this.doc.setFont("helvetica", "bold");
    this.doc.text(`${label}:`, this.margin, this.yPosition);
    this.yPosition += 5;
    this.doc.setFont("helvetica", "normal");

    const lines: string[] = this.doc.splitTextToSize(
      sanitizeTextForPdf(text),
      this.contentWidth - 5
    );
    lines.forEach((line: string) => {
      this.ensureSpace(10);
      this.doc.text(String(line), this.margin + 5, this.yPosition);
      this.yPosition += 5;
    });
    this.yPosition += 3;
  }

  /** Render a separator line */
  renderSeparator() {
    this.doc.setDrawColor(220, 220, 220);
    this.doc.line(
      this.margin,
      this.yPosition,
      this.pageWidth - this.margin,
      this.yPosition
    );
    this.yPosition += 5;
  }

  /** Render embedded images */
  renderImages(images: LoadedImage[]) {
    if (images.length === 0) return;

    this.ensureSpace(50);
    this.doc.setFont("helvetica", "bold");
    this.doc.text("Attachments:", this.margin, this.yPosition);
    this.yPosition += 6;
    this.doc.setFont("helvetica", "normal");

    images.forEach((img) => {
      let imgWidthMm = img.width * PDF_CONFIG.pixelsToMm;
      let imgHeightMm = img.height * PDF_CONFIG.pixelsToMm;

      if (imgWidthMm > this.maxImageWidth) {
        const scale = this.maxImageWidth / imgWidthMm;
        imgWidthMm = this.maxImageWidth;
        imgHeightMm = imgHeightMm * scale;
      }
      if (imgHeightMm > this.maxImageHeight) {
        const scale = this.maxImageHeight / imgHeightMm;
        imgHeightMm = this.maxImageHeight;
        imgWidthMm = imgWidthMm * scale;
      }

      if (this.yPosition + imgHeightMm + 10 > this.pageHeight - 20) {
        this.doc.addPage();
        this.yPosition = this.margin;
      }

      try {
        this.doc.addImage(
          img.dataUrl,
          "JPEG",
          this.margin + 5,
          this.yPosition,
          imgWidthMm,
          imgHeightMm
        );
        this.yPosition += imgHeightMm + 5;

        this.doc.setFontSize(8);
        this.doc.setFont("helvetica", "normal");
        const nameLines = this.doc.splitTextToSize(
          sanitizeTextForPdf(img.name),
          this.contentWidth - 10
        );
        nameLines.forEach((line: string) => {
          this.doc.text(line, this.margin + 5, this.yPosition);
          this.yPosition += 3;
        });
        this.yPosition += 5;
      } catch {
        this.doc.setFontSize(8);
        const errLines = this.doc.splitTextToSize(
          sanitizeTextForPdf(`[Failed to embed: ${img.name}]`),
          this.contentWidth - 10
        );
        errLines.forEach((line: string) => {
          this.doc.text(line, this.margin + 5, this.yPosition);
          this.yPosition += 3;
        });
        this.yPosition += 3;
      }
      this.doc.setFontSize(10);
      this.doc.setFont("helvetica", "normal");
    });
  }

  /** Render non-image attachment names */
  renderAttachmentNames(names: string[]) {
    if (names.length === 0) return;
    this.doc.setFontSize(9);
    this.doc.text(
      sanitizeTextForPdf(`Files: ${names.join(", ")}`),
      this.margin + 5,
      this.yPosition
    );
    this.yPosition += 5;
    this.doc.setFontSize(10);
  }

  /** Add page numbers to all pages */
  addPageNumbers() {
    const pageCount = this.doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      this.doc.setPage(i);
      this.doc.setFontSize(8);
      this.doc.setFont("helvetica", "normal");
      this.doc.text(
        `Page ${i} of ${pageCount}`,
        this.pageWidth / 2,
        this.pageHeight - 10,
        { align: "center" }
      );
    }
  }

  /** Save the PDF document */
  save(fileName: string) {
    this.doc.save(fileName);
  }

  /** Add vertical spacing */
  addSpace(mm: number) {
    this.yPosition += mm;
  }
}

/**
 * Format a custom field value for PDF display.
 *
 * Handles Dropdown, Multi-Select, Checkbox, Text Long, Text String, Link, Integer, etc.
 * `fieldOptions` should be the array of options from the field's template assignment.
 */
export function formatFieldValue(
  rawValue: any,
  fieldType: string | undefined,
  fieldOptions?: { fieldOption: { id: number; name: string } }[]
): string {
  if (rawValue === null || rawValue === undefined) return "";
  if (!fieldType) return String(rawValue);

  switch (fieldType) {
    case "Dropdown": {
      const opt = fieldOptions?.find((fo) => fo.fieldOption.id === rawValue);
      return opt?.fieldOption.name ?? String(rawValue);
    }
    case "Multi-Select": {
      if (Array.isArray(rawValue)) {
        const opts = fieldOptions?.filter((fo) =>
          rawValue.includes(fo.fieldOption.id)
        );
        return opts?.map((fo) => fo.fieldOption.name).join(", ") ?? "";
      }
      return "";
    }
    case "Checkbox":
      return rawValue === true ? "Yes" : "No";
    case "Text Long": {
      if (typeof rawValue === "string") {
        try {
          const parsed = JSON.parse(rawValue);
          return extractTextFromNode(parsed) ?? "";
        } catch {
          return rawValue;
        }
      }
      if (typeof rawValue === "object") {
        return extractTextFromNode(rawValue) ?? "";
      }
      return String(rawValue);
    }
    case "Text String":
    case "Link":
    case "Integer":
    default:
      return String(rawValue);
  }
}

/** Pre-load all embeddable images from attachments */
export async function preloadImages(
  attachments: { url?: string; name?: string; mimeType?: string | null; isDeleted?: boolean }[]
): Promise<{ images: LoadedImage[]; nonImageNames: string[] }> {
  const imageAttachments = attachments.filter(
    (att) => !att.isDeleted && isEmbeddableImage(att.mimeType) && att.url
  );
  const nonImageAttachments = attachments.filter(
    (att) => !att.isDeleted && !isEmbeddableImage(att.mimeType) && att.name
  );

  const results = await Promise.all(
    imageAttachments.map(async (att) => {
      const result = await loadImageAsDataUrl(att.url!, att.mimeType!);
      return result ? { name: att.name || "image", ...result } : null;
    })
  );

  return {
    images: results.filter((r): r is LoadedImage => r !== null),
    nonImageNames: nonImageAttachments.map((att) => att.name!).filter(Boolean),
  };
}
