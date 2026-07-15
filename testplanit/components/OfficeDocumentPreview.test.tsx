import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OfficeDocumentPreview } from "./OfficeDocumentPreview";

// Hoisted mock fns so the vi.mock factories (which are hoisted above imports)
// can reference them safely.
const mocks = vi.hoisted(() => ({
  renderAsync: vi.fn(async () => {}),
  xlsxRead: vi.fn(
    (): {
      SheetNames: string[];
      Sheets: Record<string, { "!ref"?: string }>;
    } => ({
      SheetNames: ["Sheet1"],
      Sheets: { Sheet1: { "!ref": "A1:B2" } },
    })
  ),
  sheetToHtml: vi.fn(() => "<table><tr><td>A1</td></tr></table>"),
  sanitize: vi.fn((html: string) => html),
  loadFile: vi.fn(async () => {}),
  pptxRender: vi.fn(async () => {}),
  getSlideCount: vi.fn(() => 3),
  getCurrentSlideIndex: vi.fn(() => 0),
  goToSlide: vi.fn(async () => {}),
  destroy: vi.fn(),
  PPTXViewer: vi.fn(),
}));

vi.mock("docx-preview", () => ({ renderAsync: mocks.renderAsync }));
vi.mock("xlsx", () => ({
  read: mocks.xlsxRead,
  utils: { sheet_to_html: mocks.sheetToHtml },
}));
vi.mock("dompurify", () => ({ default: { sanitize: mocks.sanitize } }));
vi.mock("pptxviewjs", () => ({ PPTXViewer: mocks.PPTXViewer }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Regular function (not arrow) so it is constructable via `new`.
  mocks.PPTXViewer.mockImplementation(function (this: Record<string, unknown>) {
    this.loadFile = mocks.loadFile;
    this.render = mocks.pptxRender;
    this.getSlideCount = mocks.getSlideCount;
    this.getCurrentSlideIndex = mocks.getCurrentSlideIndex;
    this.goToSlide = mocks.goToSlide;
    this.destroy = mocks.destroy;
  });
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    blob: async () => new Blob([]),
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("OfficeDocumentPreview", () => {
  it("renders an icon and never fetches at small size", () => {
    render(
      <OfficeDocumentPreview
        fileURL="/api/storage/a.docx"
        name="a.docx"
        kind="word"
        size="small"
      />
    );
    expect(screen.getByText("a.docx")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and renders a Word document at large size", async () => {
    render(
      <OfficeDocumentPreview
        fileURL="/api/storage/a.docx"
        name="a.docx"
        kind="word"
        size="large"
      />
    );
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/storage/a.docx",
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it("parses and sanitizes an Excel document at large size", async () => {
    render(
      <OfficeDocumentPreview
        fileURL="/api/storage/a.xlsx"
        name="a.xlsx"
        kind="excel"
        size="large"
      />
    );
    await waitFor(() => expect(mocks.sheetToHtml).toHaveBeenCalledTimes(1));
    expect(mocks.xlsxRead).toHaveBeenCalledTimes(1);
    expect(mocks.sanitize).toHaveBeenCalledTimes(1);
  });

  it("shows an empty-document message for a spreadsheet with no cell range", async () => {
    mocks.xlsxRead.mockReturnValueOnce({
      SheetNames: ["Sheet1"],
      Sheets: { Sheet1: {} }, // no "!ref" → empty sheet
    });
    render(
      <OfficeDocumentPreview
        fileURL="/api/storage/empty.xlsx"
        name="empty.xlsx"
        kind="excel"
        size="large"
      />
    );
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        "/api/storage/empty.xlsx"
      )
    );
    // sheet_to_html must not be called when there is no data range
    expect(mocks.sheetToHtml).not.toHaveBeenCalled();
  });

  it("loads and renders a PowerPoint document to a canvas at large size", async () => {
    render(
      <OfficeDocumentPreview
        fileURL="/api/storage/a.pptx"
        name="a.pptx"
        kind="powerpoint"
        size="large"
      />
    );
    await waitFor(() => expect(mocks.pptxRender).toHaveBeenCalledTimes(1));
    expect(mocks.PPTXViewer).toHaveBeenCalledTimes(1);
    expect(mocks.loadFile).toHaveBeenCalledTimes(1);
  });

  it("skips parsing and shows a download fallback for oversized files", () => {
    render(
      <OfficeDocumentPreview
        fileURL="/api/storage/big.docx"
        name="big.docx"
        kind="word"
        size="large"
        sizeBytes={50 * 1024 * 1024}
      />
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.renderAsync).not.toHaveBeenCalled();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/api/storage/big.docx");
    expect(link).toHaveAttribute("download", "big.docx");
  });

  it("shows a download fallback when the fetch fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    render(
      <OfficeDocumentPreview
        fileURL="/api/storage/bad.docx"
        name="bad.docx"
        kind="word"
        size="large"
      />
    );
    await waitFor(() =>
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        "/api/storage/bad.docx"
      )
    );
    expect(mocks.renderAsync).not.toHaveBeenCalled();
  });
});
