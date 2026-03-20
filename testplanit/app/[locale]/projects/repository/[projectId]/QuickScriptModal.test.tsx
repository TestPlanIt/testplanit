import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs (vi.hoisted prevents OOM from unstable references) ---

const {
  mockCheckAiExportAvailable,
  mockGenerateAiExport,
  mockGenerateAiExportBatch,
  mockFetchCasesForQuickScript,
  mockLogDataExport,
  mockUseFindManyCaseExportTemplate,
  mockUseFindManyCaseExportTemplateProjectAssignment,
  mockUseFindUniqueProjects,
} = vi.hoisted(() => ({
  mockCheckAiExportAvailable: vi.fn(),
  mockGenerateAiExport: vi.fn(),
  mockGenerateAiExportBatch: vi.fn(),
  mockFetchCasesForQuickScript: vi.fn(),
  mockLogDataExport: vi.fn(),
  mockUseFindManyCaseExportTemplate: vi.fn(),
  mockUseFindManyCaseExportTemplateProjectAssignment: vi.fn(),
  mockUseFindUniqueProjects: vi.fn(),
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

vi.mock("~/lib/hooks", () => ({
  useFindManyCaseExportTemplate: mockUseFindManyCaseExportTemplate,
  useFindManyCaseExportTemplateProjectAssignment:
    mockUseFindManyCaseExportTemplateProjectAssignment,
  useFindUniqueProjects: mockUseFindUniqueProjects,
}));

vi.mock("~/app/actions/aiExportActions", () => ({
  checkAiExportAvailable: mockCheckAiExportAvailable,
  generateAiExport: mockGenerateAiExport,
  generateAiExportBatch: mockGenerateAiExportBatch,
}));

vi.mock("~/app/actions/quickScriptActions", () => ({
  fetchCasesForQuickScript: mockFetchCasesForQuickScript,
}));

vi.mock("~/lib/services/auditClient", () => ({
  logDataExport: mockLogDataExport,
}));

vi.mock("./ExportPreviewPane", () => ({
  ExportPreviewPane: ({
    results,
    onDownload,
    onClose,
  }: {
    results: any[];
    onDownload: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="export-preview">
      <span data-testid="preview-results-count">{results.length}</span>
      <button onClick={onDownload}>download</button>
      <button onClick={onClose}>close-preview</button>
    </div>
  ),
}));

vi.mock("~/utils", () => ({
  cn: (...classes: (string | undefined | null | false)[]) =>
    classes.filter(Boolean).join(" "),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./quickScriptUtils", () => ({
  sanitizeFilename: vi.fn((name: string) => name),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: React.PropsWithChildren<{ open?: boolean; onOpenChange?: any }>) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({
    children,
    ...props
  }: React.PropsWithChildren<{ className?: string; "data-testid"?: string }>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children }: React.PropsWithChildren<object>) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: React.PropsWithChildren<object>) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: React.PropsWithChildren<object>) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: React.PropsWithChildren<object>) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: React.PropsWithChildren<object>) => (
    <div data-testid="command">{children}</div>
  ),
  CommandInput: (props: any) => <input data-testid="command-input" {...props} />,
  CommandList: ({ children, ...props }: React.PropsWithChildren<object>) => (
    <div data-testid="command-list" {...props}>
      {children}
    </div>
  ),
  CommandEmpty: ({ children }: React.PropsWithChildren<object>) => (
    <div data-testid="command-empty">{children}</div>
  ),
  CommandGroup: ({
    children,
    heading,
  }: React.PropsWithChildren<{ heading?: string }>) => (
    <div data-testid="command-group">
      {heading && <div data-testid="command-group-heading">{heading}</div>}
      {children}
    </div>
  ),
  CommandItem: ({
    children,
    onSelect,
    value,
    ...props
  }: React.PropsWithChildren<{ onSelect?: () => void; value?: string }>) => (
    <div
      data-testid="command-item"
      onClick={onSelect}
      role="option"
      {...props}
    >
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    _open,
    _onOpenChange,
  }: React.PropsWithChildren<{ _open?: boolean; _onOpenChange?: any }>) => (
    <div data-testid="popover">{children}</div>
  ),
  PopoverTrigger: ({
    children,
    _asChild,
  }: React.PropsWithChildren<{ _asChild?: boolean }>) => <>{children}</>,
  PopoverContent: ({ children }: React.PropsWithChildren<object>) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({
    children,
    value,
    onValueChange,
    ...props
  }: React.PropsWithChildren<{
    value?: string;
    onValueChange?: (v: string) => void;
    "data-testid"?: string;
  }>) => (
    <div role="radiogroup" {...props}>
      {children}
    </div>
  ),
  RadioGroupItem: ({
    value,
    id,
    disabled,
  }: {
    value?: string;
    id?: string;
    disabled?: boolean;
  }) => (
    <input
      type="radio"
      value={value}
      id={id}
      disabled={disabled}
      data-testid={`radio-${value}`}
    />
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
  }) => (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      role="switch"
      data-testid="ai-switch"
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    htmlFor,
    ...props
  }: React.PropsWithChildren<{ htmlFor?: string; className?: string }>) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
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
    type?: string;
    role?: string;
    "aria-expanded"?: boolean;
    "data-testid"?: string;
  }>) => (
    <button onClick={onClick} disabled={disabled} {...(props as any)}>
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

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren<object>) => (
    <>{children}</>
  ),
  TooltipProvider: ({
    children,
  }: React.PropsWithChildren<{ delayDuration?: number }>) => <>{children}</>,
  TooltipTrigger: ({
    children,
    _asChild,
  }: React.PropsWithChildren<{ _asChild?: boolean }>) => <>{children}</>,
  TooltipContent: ({ children }: React.PropsWithChildren<object>) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// --- Import Component Under Test ---

import { QuickScriptModal } from "./QuickScriptModal";

// --- Fixtures ---

const mockTemplate = {
  id: 1,
  name: "Playwright",
  category: "E2E",
  framework: "playwright",
  language: "typescript",
  templateBody: "test('{{name}}', () => {});",
  headerBody: null,
  footerBody: null,
  fileExtension: ".spec.ts",
  isDefault: true,
  isEnabled: true,
  isDeleted: false,
};

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  selectedCaseIds: [1, 2],
  projectId: 42,
};

// --- Test Setup ---

beforeEach(() => {
  vi.clearAllMocks();

  // Default: templates loaded with one default template
  mockUseFindManyCaseExportTemplate.mockReturnValue({
    data: [mockTemplate],
  });

  mockUseFindManyCaseExportTemplateProjectAssignment.mockReturnValue({
    data: [],
  });

  mockUseFindUniqueProjects.mockReturnValue({
    data: null,
  });

  // Default: AI not available
  mockCheckAiExportAvailable.mockResolvedValue({
    available: false,
    hasCodeContext: false,
  });

  // Default: fetchCasesForQuickScript success
  mockFetchCasesForQuickScript.mockResolvedValue({
    success: true,
    data: [
      { id: 1, name: "Login Test", folder: "", state: "active", estimate: null, automated: false, tags: "", createdBy: "user", createdAt: "2024-01-01", steps: [], fields: {} },
      { id: 2, name: "Logout Test", folder: "", state: "active", estimate: null, automated: false, tags: "", createdBy: "user", createdAt: "2024-01-01", steps: [], fields: {} },
    ],
  });
});

// --- Tests ---

describe("QuickScriptModal", () => {
  it("renders dialog with title and template selector when isOpen=true", async () => {
    render(<QuickScriptModal {...defaultProps} />);

    // Dialog renders (mocked as conditional on open prop)
    expect(screen.getByTestId("dialog")).toBeInTheDocument();

    // Title renders (from t("title"))
    expect(screen.getByText("title")).toBeInTheDocument();

    // Template selector button renders
    expect(
      screen.getByTestId("quickscript-template-select")
    ).toBeInTheDocument();
  });

  it("shows template name in selector button when template loaded (auto-selects default)", async () => {
    render(<QuickScriptModal {...defaultProps} />);

    // The default template name appears in the selector button (may appear multiple times
    // — in the trigger button and in the command item list)
    const instances = screen.getAllByText("Playwright");
    expect(instances.length).toBeGreaterThanOrEqual(1);

    // The trigger button specifically contains the template name
    const triggerBtn = screen.getByTestId("quickscript-template-select");
    expect(triggerBtn).toHaveTextContent("Playwright");
  });

  it("renders output mode radio group with individual and single options", () => {
    render(<QuickScriptModal {...defaultProps} />);

    expect(screen.getByTestId("quickscript-output-mode")).toBeInTheDocument();
    expect(screen.getByTestId("radio-individual")).toBeInTheDocument();
    expect(screen.getByTestId("radio-single")).toBeInTheDocument();
  });

  it("export button has data-testid=quickscript-button and is enabled when template selected", async () => {
    render(<QuickScriptModal {...defaultProps} />);

    const exportBtn = screen.getByTestId("quickscript-button");
    expect(exportBtn).toBeInTheDocument();
    // Template is auto-selected (isDefault=true), so button should be enabled
    expect(exportBtn).not.toBeDisabled();
  });

  it("shows AI toggle section when AI is available", async () => {
    mockCheckAiExportAvailable.mockResolvedValue({
      available: true,
      hasCodeContext: true,
    });

    render(<QuickScriptModal {...defaultProps} />);

    // Wait for the checkAiExportAvailable call to resolve (aiCheckLoading becomes false)
    await waitFor(() => {
      expect(screen.getByTestId("ai-export-toggle")).toBeInTheDocument();
    });
  });

  it("does not show AI toggle when AI is not available", async () => {
    // Default mock: available=false
    render(<QuickScriptModal {...defaultProps} />);

    // Wait for AI check to complete
    await waitFor(() => {
      expect(mockCheckAiExportAvailable).toHaveBeenCalledWith({ projectId: 42 });
    });

    // AI toggle should not be present
    expect(screen.queryByTestId("ai-export-toggle")).not.toBeInTheDocument();
  });

  it("clicking cancel button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<QuickScriptModal {...defaultProps} onClose={onClose} />);

    // Cancel button renders tCommon("cancel") = "cancel"
    const cancelBtn = screen.getByText("cancel");
    await user.click(cancelBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render dialog content when isOpen=false", () => {
    render(<QuickScriptModal {...defaultProps} isOpen={false} />);

    // Dialog mock gates rendering on open prop
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quickscript-template-select")).not.toBeInTheDocument();
  });

  it("clicking export button calls fetchCasesForQuickScript with correct args", async () => {
    const user = userEvent.setup();

    // Use mustache (non-AI) path — mockFetchCasesForQuickScript is set up in beforeEach
    // AI is not available (default), so aiEnabled=false initially but the component
    // sets aiEnabled=true on close. Since AI not available, toggle won't show.
    // The standard export path calls fetchCasesForQuickScript directly.

    render(<QuickScriptModal {...defaultProps} />);

    const exportBtn = screen.getByTestId("quickscript-button");
    await user.click(exportBtn);

    await waitFor(() => {
      expect(mockFetchCasesForQuickScript).toHaveBeenCalledWith({
        caseIds: [1, 2],
        projectId: 42,
      });
    });
  });
});
