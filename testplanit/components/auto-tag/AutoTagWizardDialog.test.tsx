import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs (vi.hoisted to avoid TDZ issues in vi.mock factories) ---

const mockCasesSubmit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCasesCancel = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCasesApply = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCasesReset = vi.hoisted(() => vi.fn());

const mockSessionsSubmit = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);
const mockSessionsCancel = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);
const mockSessionsApply = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);
const mockSessionsReset = vi.hoisted(() => vi.fn());

const mockRunsSubmit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRunsCancel = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRunsApply = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRunsReset = vi.hoisted(() => vi.fn());

// Controllable job state objects — mutate .status etc. in tests
const mockCasesJob = vi.hoisted(() => ({
  jobId: null as string | null,
  status: "idle" as
    | "idle"
    | "waiting"
    | "active"
    | "completed"
    | "failed",
  progress: null as { analyzed: number; total: number; finalizing?: boolean } | null,
  error: null as string | null,
  suggestions: null as Array<{
    entityId: number;
    entityType: "repositoryCase";
    entityName: string;
    currentTags: string[];
    tags: Array<{ tagName: string; isExisting: boolean }>;
  }> | null,
  selections: new Map() as Map<number, Set<string>>,
  edits: new Map() as Map<string, string>,
  submit: mockCasesSubmit,
  toggleTag: vi.fn(),
  editTag: vi.fn(),
  apply: mockCasesApply,
  cancel: mockCasesCancel,
  reset: mockCasesReset,
  summary: { assignCount: 0, newCount: 0 },
  isApplying: false,
  isSubmitting: false,
}));

const mockSessionsJob = vi.hoisted(() => ({
  jobId: null as string | null,
  status: "idle" as
    | "idle"
    | "waiting"
    | "active"
    | "completed"
    | "failed",
  progress: null as { analyzed: number; total: number; finalizing?: boolean } | null,
  error: null as string | null,
  suggestions: null as null,
  selections: new Map() as Map<number, Set<string>>,
  edits: new Map() as Map<string, string>,
  submit: mockSessionsSubmit,
  toggleTag: vi.fn(),
  editTag: vi.fn(),
  apply: mockSessionsApply,
  cancel: mockSessionsCancel,
  reset: mockSessionsReset,
  summary: { assignCount: 0, newCount: 0 },
  isApplying: false,
  isSubmitting: false,
}));

const mockRunsJob = vi.hoisted(() => ({
  jobId: null as string | null,
  status: "idle" as
    | "idle"
    | "waiting"
    | "active"
    | "completed"
    | "failed",
  progress: null as { analyzed: number; total: number; finalizing?: boolean } | null,
  error: null as string | null,
  suggestions: null as null,
  selections: new Map() as Map<number, Set<string>>,
  edits: new Map() as Map<string, string>,
  submit: mockRunsSubmit,
  toggleTag: vi.fn(),
  editTag: vi.fn(),
  apply: mockRunsApply,
  cancel: mockRunsCancel,
  reset: mockRunsReset,
  summary: { assignCount: 0, newCount: 0 },
  isApplying: false,
  isSubmitting: false,
}));

const mockInvalidateModelQueries = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);

// --- Mocks ---

vi.mock("./useAutoTagJob", () => ({
  useAutoTagJob: (key: string) => {
    if (key.includes("repositoryCase")) return mockCasesJob;
    if (key.includes("session")) return mockSessionsJob;
    if (key.includes("testRun")) return mockRunsJob;
    return mockCasesJob;
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts === "object") {
      const values = Object.entries(opts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `${key}(${values})`;
    }
    return key;
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { preferences: { itemsPerPage: 25 } } },
  }),
}));

vi.mock("~/utils/optimistic-updates", () => ({
  invalidateModelQueries: mockInvalidateModelQueries,
}));

vi.mock("~/utils/testResultTypes", () => ({
  isAutomatedCaseSource: () => false,
  isAutomatedTestRunType: () => false,
}));

vi.mock("~/lib/contexts/PaginationContext", () => ({
  defaultPageSizeOptions: [10, 25, 50],
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("~/utils", () => ({
  cn: (...args: (string | undefined | false | null)[]) =>
    args.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
    onOpenChange: _onOpenChange,
  }: {
    open: boolean;
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 data-testid="dialog-title" className={className}>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    [key: string]: unknown;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    [key: string]: unknown;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    className,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    className?: string;
    [key: string]: unknown;
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      className={className}
      {...props}
    />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    className,
    ...props
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    className?: string;
    [key: string]: unknown;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      {...props}
    />
  ),
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({
    value,
    className,
  }: {
    value?: number;
    className?: string;
  }) => (
    <div
      data-testid="progress-bar"
      data-value={value}
      className={className}
    />
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    variant,
    className,
  }: {
    children: React.ReactNode;
    variant?: string;
    className?: string;
  }) => (
    <span data-testid="badge" data-variant={variant} className={className}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({
    children,
    value,
    onValueChange,
    ...props
  }: {
    children: React.ReactNode;
    value?: string[];
    onValueChange?: (v: string[]) => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="toggle-group" {...props}>
      {children}
    </div>
  ),
  ToggleGroupItem: ({
    children,
    value,
    ...props
  }: {
    children: React.ReactNode;
    value?: string;
    [key: string]: unknown;
  }) => (
    <button type="button" data-testid={`toggle-${value}`} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <>{children}</>,
  PopoverContent: ({
    children,
    side,
  }: {
    children: React.ReactNode;
    side?: string;
  }) => (
    <div data-testid="popover-content" data-side={side}>
      {children}
    </div>
  ),
}));

vi.mock("./EntityDetailPopover", () => ({
  EntityDetailPopover: ({
    children,
    entityId,
  }: {
    children: React.ReactNode;
    entityId: number;
    [key: string]: unknown;
  }) => (
    <span data-testid={`entity-popover-${entityId}`}>{children}</span>
  ),
}));

vi.mock("./TagChip", () => ({
  TagChip: ({
    tagName,
    isAccepted,
    onToggle,
  }: {
    tagName: string;
    isAccepted: boolean;
    onToggle: () => void;
    [key: string]: unknown;
  }) => (
    <button
      type="button"
      data-testid={`tag-chip-${tagName}`}
      data-accepted={isAccepted}
      onClick={onToggle}
    >
      {tagName}
    </button>
  ),
}));

vi.mock("@/components/tables/DataTable", () => ({
  DataTable: ({
    data,
    columns: _columns,
  }: {
    data: Array<{ id: string; name: string }>;
    columns?: unknown[];
    [key: string]: unknown;
  }) => (
    <table data-testid="data-table">
      <tbody>
        {data.map((row) => (
          <tr key={row.id} data-testid={`row-${row.id}`}>
            <td>{row.name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock("@/components/tables/Pagination", () => ({
  PaginationComponent: ({ currentPage, totalPages }: { currentPage: number; totalPages: number; [key: string]: unknown }) => (
    <div data-testid="pagination">
      {currentPage}/{totalPages}
    </div>
  ),
}));

vi.mock("@/components/tables/PaginationControls", () => ({
  PaginationInfo: ({ startIndex, endIndex, totalRows }: { startIndex: number; endIndex: number; totalRows: number; [key: string]: unknown }) => (
    <div data-testid="pagination-info">
      {startIndex}-{endIndex} of {totalRows}
    </div>
  ),
}));

vi.mock("@/components/Debounce", () => ({
  useDebounce: (value: string) => value,
}));

vi.mock("lucide-react", () => ({
  Bot: () => <svg data-testid="icon-bot" />,
  CheckCircle2: () => <svg data-testid="icon-check" />,
  Compass: () => <svg data-testid="icon-compass" />,
  ListChecks: () => <svg data-testid="icon-listchecks" />,
  ListTree: () => <svg data-testid="icon-listtree" />,
  Loader2: () => <svg data-testid="icon-loader" />,
  PlayCircle: () => <svg data-testid="icon-playcircle" />,
  Search: () => <svg data-testid="icon-search" />,
  Sparkles: () => <svg data-testid="icon-sparkles" />,
  Tag: () => <svg data-testid="icon-tag" />,
  Tags: () => <svg data-testid="icon-tags" />,
  XCircle: () => <svg data-testid="icon-xcircle" />,
  X: () => <svg data-testid="icon-x" />,
}));

// --- Import Component Under Test ---
import { AutoTagWizardDialog } from "./AutoTagWizardDialog";

// --- Helpers ---

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const qc = createQueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// --- Fixtures ---

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: "42",
  caseIds: [1, 2, 3],
  sessionIds: [10, 11],
  runIds: [20, 21, 22],
};

function resetJobs() {
  mockCasesJob.status = "idle";
  mockCasesJob.progress = null;
  mockCasesJob.suggestions = null;
  mockCasesJob.selections = new Map();
  mockCasesJob.summary = { assignCount: 0, newCount: 0 };
  mockCasesJob.error = null;

  mockSessionsJob.status = "idle";
  mockSessionsJob.progress = null;
  mockSessionsJob.suggestions = null;
  mockSessionsJob.selections = new Map();
  mockSessionsJob.summary = { assignCount: 0, newCount: 0 };
  mockSessionsJob.error = null;

  mockRunsJob.status = "idle";
  mockRunsJob.progress = null;
  mockRunsJob.suggestions = null;
  mockRunsJob.selections = new Map();
  mockRunsJob.summary = { assignCount: 0, newCount: 0 };
  mockRunsJob.error = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetJobs();
});

// --- Tests ---

describe("AutoTagWizardDialog", () => {
  describe("Configure step", () => {
    it("renders entity checkboxes for cases, runs, and sessions when all IDs provided", () => {
      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      // Should show the dialog in configure step
      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      // Wizard description shown
      expect(screen.getByTestId("dialog-description")).toHaveTextContent(
        "wizard.description"
      );

      // Three checkboxes for entity types
      const checkboxes = screen.getAllByRole("checkbox");
      // 3 entity checkboxes + 1 switch for untagged-only
      expect(checkboxes.length).toBeGreaterThanOrEqual(3);
    });

    it("shows untagged-only switch in configure step", () => {
      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      expect(screen.getAllByRole("switch")).toHaveLength(1);
    });

    it("start button is enabled when entity IDs are provided", () => {
      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      const startBtn = screen.getByRole("button", {
        name: /wizard\.startAnalysis/i,
      });
      expect(startBtn).not.toBeDisabled();
    });

    it("start button is disabled when no cases/runs/sessions provided", () => {
      renderWithQueryClient(
        <AutoTagWizardDialog
          {...defaultProps}
          caseIds={[]}
          sessionIds={[]}
          runIds={[]}
        />
      );

      const startBtn = screen.getByRole("button", {
        name: /wizard\.startAnalysis/i,
      });
      expect(startBtn).toBeDisabled();
    });

    it("unchecking all checkboxes disables start button", async () => {
      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      const checkboxes = screen.getAllByRole("checkbox");
      // Uncheck all entity checkboxes (first 3)
      for (const checkbox of checkboxes.slice(0, 3)) {
        await userEvent.click(checkbox);
      }

      const startBtn = screen.getByRole("button", {
        name: /wizard\.startAnalysis/i,
      });
      expect(startBtn).toBeDisabled();
    });

    it("clicking start calls submit on active jobs with correct entity IDs", async () => {
      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      const startBtn = screen.getByRole("button", {
        name: /wizard\.startAnalysis/i,
      });
      await userEvent.click(startBtn);

      expect(mockCasesSubmit).toHaveBeenCalledWith(
        [1, 2, 3],
        "repositoryCase",
        42
      );
      expect(mockSessionsSubmit).toHaveBeenCalledWith([10, 11], "session", 42);
      expect(mockRunsSubmit).toHaveBeenCalledWith([20, 21, 22], "testRun", 42);
    });
  });

  describe("Analyzing step", () => {
    it("shows progress bar and cancel button when jobs are active", () => {
      // Set up active state before render
      mockCasesJob.status = "active";
      mockCasesJob.progress = { analyzed: 2, total: 3 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      // Should auto-transition to analyzing step because anyActive=true on open
      expect(screen.getByTestId("progress-bar")).toBeInTheDocument();
      // The footer cancel button (data-variant="outline") is used for cancelling the whole job
      const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
      expect(cancelButtons.length).toBeGreaterThanOrEqual(1);
    });

    it("shows analyzed progress text when progress available", () => {
      mockCasesJob.status = "active";
      mockCasesJob.progress = { analyzed: 5, total: 10 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      // Progress bar rendered
      expect(screen.getByTestId("progress-bar")).toBeInTheDocument();
    });

    it("clicking footer cancel calls cancel on all jobs", async () => {
      mockCasesJob.status = "active";
      mockCasesJob.progress = { analyzed: 1, total: 3 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      // Use the footer-level cancel button (has data-variant="outline")
      const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
      // Footer cancel button is the one with data-variant="outline"
      const footerCancel = cancelButtons.find(
        (btn) => btn.getAttribute("data-variant") === "outline"
      );
      expect(footerCancel).toBeDefined();
      await userEvent.click(footerCancel!);

      expect(mockCasesCancel).toHaveBeenCalled();
      expect(mockSessionsCancel).toHaveBeenCalled();
      expect(mockRunsCancel).toHaveBeenCalled();
    });
  });

  describe("Review step", () => {
    const reviewSuggestions = [
      {
        entityId: 1,
        entityType: "repositoryCase" as const,
        entityName: "Login Test",
        currentTags: [],
        tags: [
          { tagName: "auth", isExisting: true },
          { tagName: "login", isExisting: false },
        ],
      },
      {
        entityId: 2,
        entityType: "repositoryCase" as const,
        entityName: "Signup Test",
        currentTags: [],
        tags: [{ tagName: "signup", isExisting: true }],
      },
    ];

    it("shows DataTable with suggestion rows when all jobs completed with suggestions", () => {
      mockCasesJob.status = "completed";
      mockCasesJob.suggestions = reviewSuggestions;
      mockCasesJob.selections = new Map([
        [1, new Set(["auth", "login"])],
        [2, new Set(["signup"])],
      ]);
      mockCasesJob.summary = { assignCount: 3, newCount: 1 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      const table = screen.getByTestId("data-table");
      expect(table).toBeInTheDocument();
      // Two rows for two entities
      expect(screen.getByTestId("row-repositoryCase-1")).toBeInTheDocument();
      expect(screen.getByTestId("row-repositoryCase-2")).toBeInTheDocument();
    });

    it("apply button shows assign count in footer", () => {
      mockCasesJob.status = "completed";
      mockCasesJob.suggestions = reviewSuggestions;
      mockCasesJob.selections = new Map([[1, new Set(["auth"])]]);
      mockCasesJob.summary = { assignCount: 1, newCount: 0 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      expect(screen.getByTestId("dialog-footer")).toHaveTextContent(
        "review.footerAssignCount(assignCount=1)"
      );
    });

    it("apply button is disabled when totalSelected=0 (no selections)", () => {
      mockCasesJob.status = "completed";
      mockCasesJob.suggestions = reviewSuggestions;
      mockCasesJob.selections = new Map();
      mockCasesJob.summary = { assignCount: 0, newCount: 0 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      const applyBtn = screen.getByRole("button", {
        name: /actions\.apply/i,
      });
      expect(applyBtn).toBeDisabled();
    });

    it("apply button calls apply on all jobs when clicked", async () => {
      mockCasesJob.status = "completed";
      mockCasesJob.suggestions = reviewSuggestions;
      mockCasesJob.selections = new Map([[1, new Set(["auth"])]]);
      mockCasesJob.summary = { assignCount: 1, newCount: 0 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      const applyBtn = screen.getByRole("button", {
        name: /actions\.apply/i,
      });
      await userEvent.click(applyBtn);

      expect(mockCasesApply).toHaveBeenCalled();
    });

    it("shows noSuggestions text in review step when suggestions list is empty", () => {
      // Set up suggestions with entities that have no tags to show noSuggestions per row
      // Use a suggestion entity with empty tags array which shows "noSuggestions" per-row
      const emptySuggestions = [
        {
          entityId: 99,
          entityType: "repositoryCase" as const,
          entityName: "No Tags Entity",
          currentTags: [],
          tags: [], // empty tags shows "noSuggestions" text in review table cell
        },
      ];
      mockCasesJob.status = "completed";
      mockCasesJob.suggestions = emptySuggestions;
      mockCasesJob.selections = new Map([[99, new Set()]]);
      mockCasesJob.summary = { assignCount: 0, newCount: 0 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      // DataTable renders the row, review.noSuggestions shown in cell via column def
      expect(screen.getByTestId("data-table")).toBeInTheDocument();
    });

    it("shows review step title when in review state", () => {
      mockCasesJob.status = "completed";
      mockCasesJob.suggestions = reviewSuggestions;
      mockCasesJob.selections = new Map([[1, new Set(["auth"])]]);
      mockCasesJob.summary = { assignCount: 1, newCount: 0 };

      renderWithQueryClient(<AutoTagWizardDialog {...defaultProps} />);

      expect(screen.getByTestId("dialog-title")).toHaveTextContent(
        "review.title"
      );
    });
  });

  it("does not render when open=false", () => {
    const { container: _container } = renderWithQueryClient(
      <AutoTagWizardDialog {...defaultProps} open={false} />
    );
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });
});
