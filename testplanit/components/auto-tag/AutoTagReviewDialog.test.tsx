import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs ---

const mockJobApply = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockJobReset = vi.hoisted(() => vi.fn());
const mockInvalidateModelQueries = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);

// --- Mocks ---

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

vi.mock("~/utils/optimistic-updates", () => ({
  invalidateModelQueries: mockInvalidateModelQueries,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="dialog-footer" className={className}>{children}</div>
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

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover">{children}</div>
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

vi.mock("./EntityList", () => ({
  EntityList: ({
    entities,
    selectedEntityId,
    onSelectEntity,
  }: {
    entities: Array<{ entityId: number; entityName: string }>;
    selectedEntityId: number | null;
    onSelectEntity: (id: number) => void;
  }) => (
    <div data-testid="entity-list">
      {entities.map((e) => (
        <button
          key={e.entityId}
          type="button"
          data-testid={`entity-item-${e.entityId}`}
          data-selected={e.entityId === selectedEntityId}
          onClick={() => onSelectEntity(e.entityId)}
        >
          {e.entityName}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./EntitySuggestions", () => ({
  EntitySuggestions: ({
    entity,
  }: {
    entity: { entityName: string };
  }) => (
    <div data-testid="entity-suggestions">
      <span>{entity.entityName}</span>
    </div>
  ),
}));

vi.mock("lucide-react", () => ({
  Loader2: () => <svg data-testid="icon-loader" />,
  Tag: () => <svg data-testid="icon-tag" />,
}));

// --- Import Component Under Test ---
import { AutoTagReviewDialog } from "./AutoTagReviewDialog";
import type { UseAutoTagJobReturn } from "./types";

// --- Helpers ---

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const qc = createQueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// --- Fixtures ---

const mockSuggestions = [
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
    currentTags: ["existing-tag"],
    tags: [
      { tagName: "signup", isExisting: true },
      { tagName: "user", isExisting: false },
    ],
  },
];

// Pre-populated selections: entity 1 has "auth" and "login" selected
const mockSelections = new Map([
  [1, new Set(["auth", "login"])],
  [2, new Set(["signup"])],
]);

function buildMockJob(
  overrides: Partial<UseAutoTagJobReturn> = {}
): UseAutoTagJobReturn {
  return {
    jobId: "job-123",
    status: "completed",
    progress: null,
    error: null,
    suggestions: mockSuggestions,
    selections: mockSelections,
    edits: new Map(),
    submit: vi.fn().mockResolvedValue(undefined),
    toggleTag: vi.fn(),
    editTag: vi.fn(),
    apply: mockJobApply,
    cancel: vi.fn().mockResolvedValue(undefined),
    reset: mockJobReset,
    summary: { assignCount: 3, newCount: 2 },
    isApplying: false,
    isSubmitting: false,
    ...overrides,
  };
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  job: buildMockJob(),
  onApplied: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("AutoTagReviewDialog", () => {
  it("renders dialog title and description when open and suggestions present", () => {
    renderWithQueryClient(<AutoTagReviewDialog {...defaultProps} />);

    expect(screen.getByTestId("dialog-title")).toHaveTextContent("title");
    expect(screen.getByTestId("dialog-description")).toHaveTextContent(
      "description"
    );
  });

  it("returns null when job.suggestions is null", () => {
    const nullSuggestionsJob = buildMockJob({ suggestions: null });
    const { container: _container } = renderWithQueryClient(
      <AutoTagReviewDialog {...defaultProps} job={nullSuggestionsJob} />
    );
    // Dialog should not render
    expect(screen.queryByTestId("dialog-title")).not.toBeInTheDocument();
  });

  it("renders EntityList with suggestions and EntitySuggestions for selected entity", () => {
    renderWithQueryClient(<AutoTagReviewDialog {...defaultProps} />);

    expect(screen.getByTestId("entity-list")).toBeInTheDocument();
    // Both entities shown in entity list
    expect(screen.getByTestId("entity-item-1")).toBeInTheDocument();
    expect(screen.getByTestId("entity-item-2")).toBeInTheDocument();

    // First entity is auto-selected, so EntitySuggestions shows for entity 1
    expect(screen.getByTestId("entity-suggestions")).toBeInTheDocument();
    expect(screen.getByTestId("entity-suggestions")).toHaveTextContent(
      "Login Test"
    );
  });

  it("shows different entity suggestions when entity is selected from list", async () => {
    renderWithQueryClient(<AutoTagReviewDialog {...defaultProps} />);

    // Click entity 2 from the entity list
    await userEvent.click(screen.getByTestId("entity-item-2"));

    // EntitySuggestions should now show for entity 2
    expect(screen.getByTestId("entity-suggestions")).toHaveTextContent(
      "Signup Test"
    );
  });

  it("apply button is disabled when totalSelected=0 (assignCount=0)", () => {
    const noSelectionsJob = buildMockJob({
      summary: { assignCount: 0, newCount: 0 },
    });
    renderWithQueryClient(
      <AutoTagReviewDialog {...defaultProps} job={noSelectionsJob} />
    );

    const applyBtn = screen.getByRole("button", { name: /actions\.apply/i });
    expect(applyBtn).toBeDisabled();
  });

  it("apply button is enabled when totalSelected > 0", () => {
    renderWithQueryClient(<AutoTagReviewDialog {...defaultProps} />);

    const applyBtn = screen.getByRole("button", { name: /actions\.apply/i });
    expect(applyBtn).not.toBeDisabled();
  });

  it("clicking apply calls job.apply() and invalidates queries", async () => {
    renderWithQueryClient(<AutoTagReviewDialog {...defaultProps} />);

    const applyBtn = screen.getByRole("button", { name: /actions\.apply/i });
    await userEvent.click(applyBtn);

    expect(mockJobApply).toHaveBeenCalledOnce();
    // Should invalidate queries (Tags and entity type)
    expect(mockInvalidateModelQueries).toHaveBeenCalled();
  });

  it("cancel button calls onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    renderWithQueryClient(
      <AutoTagReviewDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await userEvent.click(cancelBtn);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows noTagsSelected text in footer when assignCount=0", () => {
    const noSelJob = buildMockJob({
      summary: { assignCount: 0, newCount: 0 },
    });
    renderWithQueryClient(
      <AutoTagReviewDialog {...defaultProps} job={noSelJob} />
    );

    expect(screen.getByTestId("dialog-footer")).toHaveTextContent(
      "noTagsSelected"
    );
  });

  it("shows footerAssignCount text in footer when assignCount > 0", () => {
    renderWithQueryClient(<AutoTagReviewDialog {...defaultProps} />);

    expect(screen.getByTestId("dialog-footer")).toHaveTextContent(
      "footerAssignCount(assignCount=3)"
    );
  });

  it("apply button shows applying state when isApplying is true", () => {
    const applyingJob = buildMockJob({ isApplying: true });
    renderWithQueryClient(
      <AutoTagReviewDialog {...defaultProps} job={applyingJob} />
    );

    // Should show applying text
    expect(
      screen.getByRole("button", { name: /applying/i })
    ).toBeInTheDocument();
  });
});
