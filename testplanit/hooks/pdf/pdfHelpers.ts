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

/**
 * Sanitize text for PDF export. The standard jsPDF fonts (Helvetica/WinAnsi)
 * only cover Latin-1: any character outside it makes jsPDF fall back to a
 * UTF-16 path that the standard font renders as byte-interleaved garbage
 * (e.g. "V e r i f y \u2026" with stray glyphs like `\u00ff\u00fd`). So normalize Unicode
 * whitespace + typographic punctuation to ASCII, and replace anything still
 * outside Latin-1 with "?" rather than let it corrupt the whole line.
 */
export const sanitizeTextForPdf = (text: string): string => {
  if (!text) return text;
  return (
    text
      // Unicode whitespace \u2192 plain space (no glyph in the standard fonts).
      .replace(/\u202f/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\u2007/g, " ")
      .replace(/\u2008/g, " ")
      .replace(/\u2009/g, " ")
      .replace(/\u200a/g, " ")
      .replace(/\u200b/g, "")
      .replace(/\u2060/g, "")
      // Typographic punctuation \u2192 ASCII (smart quotes, dashes, ellipsis, \u2026).
      .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
      .replace(/[\u2013\u2014\u2015]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[\u2022\u2023\u2043\u25e6]/g, "-")
      .replace(/\u2122/g, "(TM)")
      .replace(/\u20ac/g, "EUR")
      // Catch-all: any remaining char outside Latin-1 has no glyph in the
      // standard fonts \u2014 a safe placeholder beats a mangled line.
      .replace(/[^\u0000-\u00ff]/g, "?")
  );
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

/**
 * Per-page header/footer metadata for evidence-grade reports. When set via
 * {@link PdfRenderer.setReportMeta}, every page gets a generation header
 * (document name + when/by-whom it was produced) on top of the page-number
 * footer.
 */
export type PdfReportMeta = {
  documentName: string;
  generatedAt: string;
  generatedByName?: string | null;
};

/** A piece of inline text with an optional RGB color (e.g. a status label). */
export type StatusToken = { text: string; color?: [number, number, number] };

/** A table cell: plain text, or a run of individually-colored status tokens. */
export type TableCell = string | StatusToken[];

/** Parse a `#rgb`/`#rrggbb` color into an RGB tuple for jsPDF, if valid. */
export function hexToRgb(
  hex: string | null | undefined
): [number, number, number] | undefined {
  if (!hex) return undefined;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return undefined;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

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
  /** Top y a fresh page starts at — raised below the header band when meta is set. */
  topOffset: number;
  reportMeta: PdfReportMeta | null;

  constructor(doc: jsPDF) {
    this.doc = doc;
    this.margin = PDF_CONFIG.margin;
    this.pageWidth = doc.internal.pageSize.width;
    this.pageHeight = doc.internal.pageSize.height;
    this.contentWidth = this.pageWidth - 2 * this.margin;
    this.maxImageWidth = this.contentWidth - 10;
    this.maxImageHeight = PDF_CONFIG.maxImageHeight;
    this.topOffset = this.margin;
    this.reportMeta = null;
    this.yPosition = this.margin;
    doc.setCharSpace(0);
  }

  /** Check if we need a new page, add one if so */
  ensureSpace(needed: number) {
    if (this.yPosition > this.pageHeight - needed) {
      this.doc.addPage();
      this.yPosition = this.topOffset;
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

  /**
   * Render a labeled field (bold label + normal value). An optional RGB color
   * is applied to the value only (e.g. a status color); the label stays black.
   */
  renderField(
    label: string,
    value: string | null | undefined,
    opts?: { color?: [number, number, number] }
  ) {
    if (!value || value.trim() === "") return;

    this.ensureSpace(30);
    this.doc.setFont("helvetica", "bold");
    this.doc.text(`${label}:`, this.margin, this.yPosition);
    this.doc.setFont("helvetica", "normal");
    if (opts?.color) {
      this.doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
    }

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

    if (opts?.color) this.doc.setTextColor(0, 0, 0);
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

  /**
   * Render a numbered step heading: "N. <step text>" in bold, wrapped with a
   * hanging indent so continuation lines align under the text.
   */
  renderStepHeading(num: number, text: string) {
    this.ensureSpace(14);
    this.yPosition += 2;
    this.doc.setFontSize(10);
    this.doc.setFont("helvetica", "bold");
    const prefix = `${num}. `;
    const prefixWidth = this.doc.getTextWidth(prefix);
    const textX = this.margin + 4 + prefixWidth;
    const lines: string[] = this.doc.splitTextToSize(
      sanitizeTextForPdf(text || "(no description)"),
      this.contentWidth - 4 - prefixWidth
    );
    this.doc.text(prefix, this.margin + 4, this.yPosition);
    lines.forEach((line: string, i: number) => {
      if (i > 0) this.ensureSpace(8);
      this.doc.text(String(line), textX, this.yPosition);
      this.yPosition += 5;
    });
    this.doc.setFont("helvetica", "normal");
  }

  /**
   * Render an indented detail line under a step ("Label: value"), with a muted
   * label and an optional RGB color for the value (e.g. a status color).
   */
  renderDetail(
    label: string,
    value: string | null | undefined,
    opts?: { color?: [number, number, number] }
  ) {
    if (!value || String(value).trim() === "") return;
    this.ensureSpace(8);
    const indent = this.margin + 9;
    this.doc.setFontSize(9);

    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(120, 120, 120);
    const labelText = `${label}: `;
    this.doc.text(labelText, indent, this.yPosition);
    const labelWidth = this.doc.getTextWidth(labelText);

    this.doc.setFont("helvetica", "normal");
    if (opts?.color) {
      this.doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
    } else {
      this.doc.setTextColor(0, 0, 0);
    }

    const valueX = indent + labelWidth;
    const lines: string[] = this.doc.splitTextToSize(
      sanitizeTextForPdf(String(value)),
      Math.max(this.pageWidth - this.margin - valueX, 40)
    );
    lines.forEach((line: string, i: number) => {
      if (i > 0) this.ensureSpace(8);
      this.doc.text(String(line), valueX, this.yPosition);
      this.yPosition += 4.5;
    });

    this.doc.setTextColor(0, 0, 0);
    this.doc.setFontSize(10);
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
        this.yPosition = this.topOffset;
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

  /**
   * Enable a per-page generation header. Reserves space at the top of every
   * page so body content does not overlap the header band. Call before
   * rendering body content; render the header/footer text in a finishing pass
   * via {@link addHeadersAndFooters}.
   */
  setReportMeta(meta: PdfReportMeta) {
    this.reportMeta = meta;
    this.topOffset = this.margin + 7;
    if (this.yPosition < this.topOffset) this.yPosition = this.topOffset;
  }

  /**
   * Render a paginated table with a bold header row that repeats at the top of
   * each continuation page. Columns are sized by relative `width` weights and
   * cells wrap within their column.
   */
  renderTable(opts: {
    columns: { header: string; width: number; align?: "left" | "right" }[];
    rows: TableCell[][];
    fontSize?: number;
  }) {
    const { columns, rows } = opts;
    const fontSize = opts.fontSize ?? 9;
    const lineHeight = fontSize * 0.45;
    const cellPadX = 1.5;
    const cellPadY = 2;
    const tokenGap = 1.5;

    const totalWeight = columns.reduce((s, c) => s + c.width, 0) || 1;
    const colWidths = columns.map(
      (c) => (c.width / totalWeight) * this.contentWidth
    );
    const colX: number[] = [];
    let acc = this.margin;
    for (const w of colWidths) {
      colX.push(acc);
      acc += w;
    }

    const wrapCell = (text: string, colIndex: number): string[] =>
      this.doc.splitTextToSize(
        sanitizeTextForPdf(text ?? ""),
        Math.max(colWidths[colIndex] - 2 * cellPadX, 6)
      );

    // Flow colored tokens into lines that fit the column width (tokens never
    // split mid-word; each keeps its color).
    const layoutTokens = (
      tokens: StatusToken[],
      colIndex: number
    ): StatusToken[][] => {
      const avail = Math.max(colWidths[colIndex] - 2 * cellPadX, 6);
      this.doc.setFontSize(fontSize);
      this.doc.setFont("helvetica", "normal");
      const lines: StatusToken[][] = [[]];
      let curW = 0;
      for (const tok of tokens) {
        const text = sanitizeTextForPdf(tok.text);
        const tw = this.doc.getTextWidth(text);
        const line = lines[lines.length - 1];
        const needed = (line.length ? tokenGap : 0) + tw;
        if (line.length && curW + needed > avail) {
          lines.push([{ ...tok, text }]);
          curW = tw;
        } else {
          line.push({ ...tok, text });
          curW += needed;
        }
      }
      return lines;
    };

    const drawHeaderRow = () => {
      const headerHeight = lineHeight + 2 * cellPadY;
      this.doc.setFillColor(240, 240, 240);
      this.doc.rect(
        this.margin,
        this.yPosition,
        this.contentWidth,
        headerHeight,
        "F"
      );
      this.doc.setFontSize(fontSize);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(0, 0, 0);
      columns.forEach((col, i) => {
        const align = col.align ?? "left";
        const x =
          align === "right"
            ? colX[i] + colWidths[i] - cellPadX
            : colX[i] + cellPadX;
        this.doc.text(
          sanitizeTextForPdf(col.header),
          x,
          this.yPosition + cellPadY + lineHeight - 1,
          {
            align,
          }
        );
      });
      this.yPosition += headerHeight;
      this.doc.setDrawColor(200, 200, 200);
      this.doc.line(
        this.margin,
        this.yPosition,
        this.margin + this.contentWidth,
        this.yPosition
      );
      this.doc.setFont("helvetica", "normal");
    };

    this.ensureSpace(30);
    drawHeaderRow();

    this.doc.setFontSize(fontSize);
    this.doc.setFont("helvetica", "normal");

    for (const row of rows) {
      // Lay out every cell up front (text wraps to lines; token cells flow to
      // lines) so the row height accounts for the tallest cell.
      const laid = row.map((cell, i) =>
        Array.isArray(cell)
          ? { kind: "tokens" as const, lines: layoutTokens(cell, i) }
          : { kind: "text" as const, lines: wrapCell(cell, i) }
      );
      const maxLines = laid.reduce((m, c) => Math.max(m, c.lines.length), 1);
      const rowHeight = maxLines * lineHeight + 2 * cellPadY;

      // Break to a new page (re-drawing the header) when the row won't fit.
      if (this.yPosition + rowHeight > this.pageHeight - 18) {
        this.doc.addPage();
        this.yPosition = this.topOffset;
        drawHeaderRow();
        this.doc.setFontSize(fontSize);
        this.doc.setFont("helvetica", "normal");
      }

      const textTop = this.yPosition + cellPadY + lineHeight - 1;
      laid.forEach((cell, i) => {
        const align = columns[i]?.align ?? "left";
        const leftX = colX[i] + cellPadX;
        if (cell.kind === "text") {
          const x =
            align === "right" ? colX[i] + colWidths[i] - cellPadX : leftX;
          cell.lines.forEach((line, li) => {
            this.doc.text(String(line), x, textTop + li * lineHeight, {
              align,
            });
          });
        } else {
          // Colored tokens are always left-aligned and flow left-to-right.
          cell.lines.forEach((tokens, li) => {
            let cx = leftX;
            const y = textTop + li * lineHeight;
            for (const tok of tokens) {
              if (tok.color)
                this.doc.setTextColor(tok.color[0], tok.color[1], tok.color[2]);
              else this.doc.setTextColor(0, 0, 0);
              this.doc.text(tok.text, cx, y);
              cx += this.doc.getTextWidth(tok.text) + tokenGap;
            }
          });
          this.doc.setTextColor(0, 0, 0);
        }
      });

      this.yPosition += rowHeight;
      this.doc.setDrawColor(230, 230, 230);
      this.doc.line(
        this.margin,
        this.yPosition,
        this.margin + this.contentWidth,
        this.yPosition
      );
    }

    this.doc.setTextColor(0, 0, 0);
    this.doc.setFontSize(10);
    this.yPosition += 4;
  }

  /**
   * Render a labeled, color-coded status breakdown (bold label, then each
   * status token in its own color, flowing across the content width).
   */
  renderStatusBreakdown(label: string, tokens: StatusToken[]) {
    if (tokens.length === 0) return;
    this.ensureSpace(16);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10);
    this.doc.text(`${label}:`, this.margin, this.yPosition);
    this.yPosition += 5;

    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9);
    const lineHeight = 9 * 0.5;
    const tokenGap = 2;
    const indent = this.margin + 5;
    const maxRight = this.pageWidth - this.margin;
    let cx = indent;
    for (const tok of tokens) {
      const text = sanitizeTextForPdf(tok.text);
      const tw = this.doc.getTextWidth(text);
      if (cx > indent && cx + tw > maxRight) {
        this.yPosition += lineHeight;
        this.ensureSpace(10);
        cx = indent;
      }
      if (tok.color)
        this.doc.setTextColor(tok.color[0], tok.color[1], tok.color[2]);
      else this.doc.setTextColor(0, 0, 0);
      this.doc.text(text, cx, this.yPosition);
      cx += tw + tokenGap;
    }
    this.doc.setTextColor(0, 0, 0);
    this.doc.setFontSize(10);
    this.yPosition += 6;
  }

  /**
   * Finishing pass: draw the generation header band (when report meta is set)
   * and a page-numbered footer on every page.
   */
  addHeadersAndFooters() {
    const meta = this.reportMeta;
    const pageCount = this.doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      this.doc.setPage(i);

      if (meta) {
        this.doc.setFontSize(8);
        this.doc.setFont("helvetica", "normal");
        this.doc.setTextColor(120, 120, 120);

        const leftMax = this.contentWidth * 0.55;
        const left = this.doc.splitTextToSize(
          sanitizeTextForPdf(meta.documentName),
          leftMax
        )[0];
        this.doc.text(String(left || ""), this.margin, 9);

        const rightText = meta.generatedByName
          ? `Generated ${meta.generatedAt} by ${meta.generatedByName}`
          : `Generated ${meta.generatedAt}`;
        const right = this.doc.splitTextToSize(
          sanitizeTextForPdf(rightText),
          this.contentWidth * 0.45
        )[0];
        this.doc.text(String(right || ""), this.pageWidth - this.margin, 9, {
          align: "right",
        });

        this.doc.setDrawColor(220, 220, 220);
        this.doc.line(this.margin, 12, this.pageWidth - this.margin, 12);
        this.doc.setTextColor(0, 0, 0);
      }

      this.doc.setFontSize(8);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(0, 0, 0);
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
  attachments: {
    url?: string;
    name?: string;
    mimeType?: string | null;
    isDeleted?: boolean;
  }[]
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
