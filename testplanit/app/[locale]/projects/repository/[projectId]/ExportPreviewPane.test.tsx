import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs ---

const { mockHighlightCode, mockMapLanguageToPrism } = vi.hoisted(() => ({
  mockHighlightCode: vi.fn((code: string) => code),
  mockMapLanguageToPrism: vi.fn((lang: string) => lang),
}));

// --- Mocks ---

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: any) => {
    if (opts && typeof opts === "object") {
      const values = Object.entries(opts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `${key}(${values})`;
    }
    return key;
  },
}));

vi.mock("prismjs/themes/prism-tomorrow.css", () => ({}));

vi.mock("~/lib/utils/codeHighlight", () => ({
  highlightCode: mockHighlightCode,
  mapLanguageToPrism: mockMapLanguageToPrism,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: React.PropsWithChildren<{
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
    className?: string;
    title?: string;
  }>) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    ...props
  }: React.PropsWithChildren<{ variant?: string; className?: string }>) => (
    <span data-testid="badge" {...props}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren<object>) => (
    <>{children}</>
  ),
  TooltipProvider: ({ children }: React.PropsWithChildren<object>) => (
    <>{children}</>
  ),
  TooltipTrigger: ({
    children,
    _asChild,
  }: React.PropsWithChildren<{ _asChild?: boolean }>) => <>{children}</>,
  TooltipContent: ({ children }: React.PropsWithChildren<object>) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children, ...props }: React.PropsWithChildren<object>) => (
    <div {...props}>{children}</div>
  ),
  CollapsibleTrigger: ({
    children,
    ...props
  }: React.PropsWithChildren<object>) => <button {...props}>{children}</button>,
  CollapsibleContent: ({
    children,
  }: React.PropsWithChildren<object>) => <div>{children}</div>,
}));

// --- Import Component Under Test ---

import { ExportPreviewPane } from "./ExportPreviewPane";
import type { AiExportResult } from "~/app/actions/aiExportActions";
import type { ParallelFileProgress } from "./QuickScriptModal";

// --- Fixtures ---

const makeResult = (overrides: Partial<AiExportResult> = {}): AiExportResult => ({
  code: "test('login', () => { expect(true).toBe(true); });",
  generatedBy: "ai",
  caseId: 1,
  caseName: "Login Test",
  ...overrides,
});

const defaultProps = {
  results: [] as AiExportResult[],
  language: "typescript",
  isGenerating: false,
  onDownload: vi.fn(),
  onClose: vi.fn(),
};

// --- Test Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  mockHighlightCode.mockImplementation((code: string) => code);
  mockMapLanguageToPrism.mockImplementation((lang: string) => lang);
});

// --- Tests ---

describe("ExportPreviewPane", () => {
  it("renders results with code content visible", () => {
    const result = makeResult();
    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[result]}
      />
    );

    expect(screen.getByText(result.code)).toBeInTheDocument();
  });

  it("download button calls onDownload when clicked", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const result = makeResult();

    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[result]}
        onDownload={onDownload}
      />
    );

    const downloadBtn = screen.getByText("downloadButton");
    await user.click(downloadBtn);

    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("close button calls onClose when clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const result = makeResult();

    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[result]}
        onClose={onClose}
      />
    );

    const closeBtn = screen.getByText("backButton");
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("when isGenerating=true with no results shows cancel button which calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[]}
        isGenerating={true}
        onCancel={onCancel}
      />
    );

    const cancelBtn = screen.getByText("cancel");
    expect(cancelBtn).toBeInTheDocument();

    await user.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("when isGenerating=true with streamingCode shows streaming content", () => {
    const streamingCode = "// live streaming code chunk";

    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[]}
        isGenerating={true}
        streamingCode={streamingCode}
      />
    );

    expect(screen.getByText(streamingCode)).toBeInTheDocument();
  });

  it("when parallelProgress provided shows per-file status items with caseName", () => {
    const parallelProgress: ParallelFileProgress[] = [
      { caseId: 1, caseName: "Login Test", status: "done" },
      { caseId: 2, caseName: "Logout Test", status: "generating" },
      { caseId: 3, caseName: "Register Test", status: "pending" },
    ];

    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[]}
        isGenerating={true}
        parallelProgress={parallelProgress}
      />
    );

    expect(screen.getByText("Login Test")).toBeInTheDocument();
    expect(screen.getByText("Logout Test")).toBeInTheDocument();
    expect(screen.getByText("Register Test")).toBeInTheDocument();
  });

  it("results with error show error indicator text in tooltip content", () => {
    const result = makeResult({
      generatedBy: "template",
      error: "AI generation failed: token limit exceeded",
    });

    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[result]}
      />
    );

    // Error appears in the tooltip content rendered via our mock
    expect(
      screen.getByText("AI generation failed: token limit exceeded")
    ).toBeInTheDocument();
  });

  it("results with generatedBy=ai show AI badge indicator", () => {
    const result1 = makeResult({ caseId: 1, caseName: "Test A", generatedBy: "ai" });
    const result2 = makeResult({ caseId: 2, caseName: "Test B", generatedBy: "template" });

    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[result1, result2]}
      />
    );

    // In multi-result view: AI badge shows "aiGenerated", template shows "templateGenerated"
    expect(screen.getByText("aiGenerated")).toBeInTheDocument();
    expect(screen.getByText("templateGenerated")).toBeInTheDocument();
  });

  it("retry button calls onRetry with correct caseId", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    // Use a single template-generated result to use SingleResultView
    // which has an explicit retry button with title="retryButton"
    const result = makeResult({
      caseId: 10,
      caseName: "Case A",
      generatedBy: "template",
    });

    render(
      <ExportPreviewPane
        {...defaultProps}
        results={[result]}
        onRetry={onRetry}
      />
    );

    // In SingleResultView, the retry button has title={t("retryButton")} which renders as "retryButton"
    const retryBtn = screen.getByTitle("retryButton");
    await user.click(retryBtn);

    // handleRetry wraps onRetry — it was called with the correct caseId
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(10);
  });

  it("returns null when no results and not generating", () => {
    const { container } = render(
      <ExportPreviewPane
        {...defaultProps}
        results={[]}
        isGenerating={false}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
