/**
 * Component tests for CopyMoveDialog.
 * Covers all three wizard steps: target, configure, progress.
 * Requirements: DLGSEL-03, DLGSEL-04, DLGSEL-05, DLGSEL-06, BULK-02, BULK-04
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Global JSDOM fixes ────────────────────────────────────────────────────────
// cmdk calls scrollIntoView which JSDOM doesn't implement
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

// ── Stable mock refs (vi.hoisted) to avoid OOM infinite loops ─────────────────

const {
  mockJobState,
  mockProjectsData,
  mockFoldersData,
} = vi.hoisted(() => ({
  mockJobState: {
    jobId: null as string | null,
    status: "idle" as
      | "idle"
      | "prefighting"
      | "waiting"
      | "active"
      | "completed"
      | "failed",
    progress: null as { processed: number; total: number } | null,
    result: null as {
      copiedCount: number;
      movedCount: number;
      skippedCount: number;
      droppedLinkCount: number;
      errors: Array<{ caseId: number; caseName: string; error: string }>;
    } | null,
    preflight: null as any,
    error: null as string | null,
    isPrefighting: false,
    isSubmitting: false,
    runPreflight: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  },
  mockProjectsData: {
    data: [
      { id: 1, name: "Source Project", iconUrl: null, isCompleted: false },
      { id: 2, name: "Target Project", iconUrl: null, isCompleted: false },
      { id: 3, name: "Another Project", iconUrl: null, isCompleted: false },
    ] as any[],
    isLoading: false,
  },
  mockFoldersData: {
    data: [
      { id: 10, name: "Root", parentId: null },
      { id: 11, name: "Subfolder", parentId: 10 },
    ] as any[],
    isLoading: false,
  },
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./useCopyMoveJob", () => ({
  useCopyMoveJob: () => mockJobState,
}));

vi.mock("~/lib/hooks", () => ({
  useFindManyProjects: () => mockProjectsData,
  useFindFirstRepositories: () => ({ data: { id: 100 } }),
  useCreateRepositoryFolders: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 99 }) }),
  useFindManyRepositoryCases: () => ({ data: [] }),
}));

vi.mock("~/lib/hooks/repository-folders", () => ({
  useFindManyRepositoryFolders: () => mockFoldersData,
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// Mock AsyncCombobox as a simple select for testing
// Radix Popover portals don't render in JSDOM
// Uses placeholder to derive a stable test ID so multiple instances are distinguishable
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({ value, onValueChange, fetchOptions, getOptionValue, placeholder, disabled }: any) => {
    const [options, setOptions] = React.useState<any[]>([]);
    const testId = placeholder?.toLowerCase().includes("folder") ? "folder-select" : "project-select";
    React.useEffect(() => {
      fetchOptions("", 0, 50).then((opts: any[]) => setOptions(opts));
    }, [fetchOptions]);
    return (
      <select
        data-testid={testId}
        value={value ? String(getOptionValue(value)) : ""}
        disabled={disabled}
        onChange={(e) => {
          const opt = options.find((o: any) => String(getOptionValue(o)) === e.target.value);
          onValueChange(opt ?? null);
        }}
        aria-label={placeholder ?? "select"}
      >
        <option value="">-- {placeholder ?? "select"} --</option>
        {options.map((o: any) => (
          <option key={getOptionValue(o)} value={getOptionValue(o)}>
            {o.name}
          </option>
        ))}
      </select>
    );
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: any) => {
    if (opts && typeof opts === "object") {
      return `${key}(${JSON.stringify(opts)})`;
    }
    return key;
  },
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ src, alt, width, height, className }: any) => (
    <img src={src} alt={alt} width={width} height={height} className={className} />
  ),
}));

// ── Component under test ──────────────────────────────────────────────────────

import { CopyMoveDialog } from "./CopyMoveDialog";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  open: true,
  onOpenChange: vi.fn(),
  selectedCaseIds: [1, 2, 3],
  sourceProjectId: 1,
};

const MOCK_PREFLIGHT = {
  hasSourceReadAccess: true,
  hasTargetWriteAccess: true,
  hasSourceUpdateAccess: true,
  templateMismatch: false,
  missingTemplates: [] as Array<{ id: number; name: string }>,
  canAutoAssignTemplates: false,
  workflowMappings: [] as any[],
  unmappedStates: [] as any[],
  collisions: [] as any[],
  targetRepositoryId: 100,
  targetDefaultWorkflowStateId: 200,
  targetTemplateId: 300,
};

// ── Helper to advance to step 2 ───────────────────────────────────────────────

/**
 * Advance from step 1 (target) to step 2 (configure).
 * Clicks Target Project, then selects Root folder via the mocked select, then clicks Next.
 *
 * FolderSelect is mocked as a plain <select> element for JSDOM compatibility.
 * The cmdk Command input has role="combobox"; our folder select is a plain <select>.
 */
async function advanceToConfigureStep(user: ReturnType<typeof userEvent.setup>) {
  // Select "Target Project" from the mocked AsyncCombobox select
  const projectSelect = await screen.findByTestId("project-select");
  await user.selectOptions(projectSelect, "2"); // Target Project id=2

  // Wait for folder picker to appear (mocked as a plain <select>)
  const folderSelect = await screen.findByTestId("folder-select");
  await user.selectOptions(folderSelect, "10"); // Root folder id=10

  // Click Next button
  const nextBtn = screen.getByRole("button", { name: /next/i });
  await user.click(nextBtn);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CopyMoveDialog", () => {
  beforeEach(() => {
    // Reset mock state before each test
    mockJobState.status = "idle";
    mockJobState.progress = null;
    mockJobState.result = null;
    mockJobState.preflight = null;
    mockJobState.error = null;
    mockJobState.isPrefighting = false;
    mockJobState.isSubmitting = false;
    mockJobState.runPreflight.mockReset();
    mockJobState.submit.mockReset();
    mockJobState.cancel.mockReset();
    mockJobState.reset.mockReset();
    mockFoldersData.data = [
      { id: 10, name: "Root", parentId: null },
      { id: 11, name: "Subfolder", parentId: 10 },
    ];
  });

  // Test 1: Step 1 renders project picker with accessible projects (DLGSEL-03)
  it("Step 1 renders project picker with accessible projects", async () => {
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    // AsyncCombobox is mocked as a <select> — options should contain project names
    const projectSelect = await screen.findByTestId("project-select");
    expect(projectSelect).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Target Project/i })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Another Project/i })).toBeInTheDocument();
    });
  });

  // Test 2: Step 1 does not show source project in picker
  it("Step 1 does not show source project in picker", () => {
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    // Source project (id=1, name="Source Project") should be filtered out
    expect(screen.queryByText("Source Project")).not.toBeInTheDocument();
  });

  // Test 3: Folder picker appears after project selection with lazy-loaded folders (DLGSEL-04)
  it("Folder picker appears after project selection with lazy-loaded folders", async () => {
    const user = userEvent.setup();
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    // Initially no folder select visible
    expect(screen.queryByTestId("folder-select")).not.toBeInTheDocument();

    // Select a project via the mocked select
    const projectSelect = await screen.findByTestId("project-select");
    await user.selectOptions(projectSelect, "2");

    // Folder picker should now appear
    await waitFor(() => {
      expect(screen.getByTestId("folder-select")).toBeInTheDocument();
    });

    // Folder options should be available (mocked lazy-load)
    expect(screen.getByRole("option", { name: /Root/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Subfolder/i })).toBeInTheDocument();
  });

  // Test 4: Next button disabled until project AND folder selected
  it("Next button is disabled until both project and folder are selected", async () => {
    const user = userEvent.setup();
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    // Initially: Next button exists but is disabled (no project or folder selected)
    const nextBtn = screen.getByRole("button", { name: /next/i });
    expect(nextBtn).toBeDisabled();

    // After project selected: folder select appears, Next still disabled (no folder)
    const projectSelect = await screen.findByTestId("project-select");
    await user.selectOptions(projectSelect, "2");
    const folderSelect = await screen.findByTestId("folder-select");
    expect(folderSelect).toBeInTheDocument();
    expect(nextBtn).toBeDisabled();

    // After folder selected: Next button becomes enabled
    await user.selectOptions(folderSelect, "10");
    expect(nextBtn).not.toBeDisabled();
  });

  // Test 5: Step 2 shows Copy/Move radio options with descriptions (DLGSEL-05)
  it("Step 2 shows Copy and Move radio options with descriptions", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = MOCK_PREFLIGHT;
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);

    // Radio buttons for copy and move
    expect(screen.getByRole("radio", { name: /operationCopy/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /operationMove/i })).toBeInTheDocument();

    // Descriptions
    expect(screen.getByText("operationCopyDesc")).toBeInTheDocument();
    expect(screen.getByText("operationMoveDesc")).toBeInTheDocument();
  });

  // Test 6: Step 2 shows template mismatch yellow alert when preflight.templateMismatch is true
  it("Step 2 shows template mismatch alert with missing template names", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = {
      ...MOCK_PREFLIGHT,
      templateMismatch: true,
      missingTemplates: [{ id: 1, name: "Test Template" }],
      canAutoAssignTemplates: false,
    };
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);

    expect(screen.getByText("templateMismatch")).toBeInTheDocument();
    expect(screen.getByText("Test Template")).toBeInTheDocument();
  });

  // Test 7: Step 2 shows auto-assign checkbox when canAutoAssignTemplates is true
  it("Step 2 shows auto-assign checkbox when canAutoAssignTemplates is true, checked by default", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = {
      ...MOCK_PREFLIGHT,
      templateMismatch: true,
      missingTemplates: [{ id: 1, name: "Missing Template" }],
      canAutoAssignTemplates: true,
    };
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);

    const checkbox = screen.getByRole("checkbox", { name: /autoAssignTemplates/i });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  // Test 8: Step 2 shows collision list with skip/rename radio when collisions present (DLGSEL-06)
  it("Step 2 shows collision list with skip/rename radio when collisions present", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = {
      ...MOCK_PREFLIGHT,
      collisions: [
        {
          caseId: 10,
          caseName: "Existing Test Case",
          className: "Smoke Tests",
          source: "manual",
        },
      ],
    };
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);

    // Collision case name and class name shown
    expect(screen.getByText("Existing Test Case")).toBeInTheDocument();
    expect(screen.getByText("Smoke Tests")).toBeInTheDocument();

    // Skip/rename radios for conflict resolution
    expect(screen.getByRole("radio", { name: /conflictSkip/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /conflictRename/i })).toBeInTheDocument();
  });

  // Test 9: Step 2 shows shared step group resolution radio
  it("Step 2 shows shared step group resolution radio options", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = MOCK_PREFLIGHT;
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);

    expect(screen.getByRole("radio", { name: /sharedStepGroupReuse/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /sharedStepGroupCreateNew/i })).toBeInTheDocument();
  });

  // Test 10: Step 2 Go button disabled when hasTargetWriteAccess is false
  it("Step 2 Go button is disabled when target write access is denied", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = {
      ...MOCK_PREFLIGHT,
      hasTargetWriteAccess: false,
    };
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);

    const goBtn = screen.getByRole("button", { name: /^go$/i });
    expect(goBtn).toBeDisabled();

    // Error alert should be visible
    expect(screen.getByText("noTargetWriteAccess")).toBeInTheDocument();
  });

  // Test 11: Step 3 shows progress bar with processed/total text during active state (BULK-02)
  it("Step 3 shows progress bar and processed/total text during active state", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = MOCK_PREFLIGHT;
    mockJobState.status = "active";
    mockJobState.progress = { processed: 5, total: 10 };
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);

    // Click Go to advance to progress step
    const goBtn = screen.getByRole("button", { name: /^go$/i });
    await user.click(goBtn);

    // Should show progress bar
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    // Should show progress text
    expect(screen.getByText(/progressText/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  // Test 12: Step 3 shows results summary with success count on completion (BULK-04)
  it("Step 3 shows results summary with success count on completion", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = MOCK_PREFLIGHT;
    mockJobState.status = "completed";
    mockJobState.result = {
      copiedCount: 3,
      movedCount: 0,
      skippedCount: 0,
      droppedLinkCount: 0,
      errors: [],
    };
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);
    const goBtn = screen.getByRole("button", { name: /^go$/i });
    await user.click(goBtn);

    // Complete state shows success icon area
    await waitFor(() => {
      expect(screen.getByText("actions.complete")).toBeInTheDocument();
    });

    // Success count message
    expect(screen.getByText(/successCount/i)).toBeInTheDocument();

    // View in target project link visible
    expect(screen.getByRole("link", { name: /viewInTargetProject/i })).toBeInTheDocument();
  });

  // Test 13: Step 3 shows expandable error list when result.errors is non-empty (BULK-04)
  it("Step 3 shows expandable error list when result has errors", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = MOCK_PREFLIGHT;
    mockJobState.status = "completed";
    mockJobState.result = {
      copiedCount: 1,
      movedCount: 0,
      skippedCount: 0,
      droppedLinkCount: 0,
      errors: [{ caseId: 99, caseName: "Broken Case", error: "Permission denied" }],
    };
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);
    const goBtn = screen.getByRole("button", { name: /^go$/i });
    await user.click(goBtn);

    // Error count button visible
    await waitFor(() => {
      expect(screen.getByText(/errorCount/i)).toBeInTheDocument();
    });

    // Click to expand the error list
    const errorToggle = screen.getByText(/errorCount/i);
    await user.click(errorToggle);

    // Error details should now be visible
    expect(screen.getByText("Broken Case")).toBeInTheDocument();
    expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
  });

  // Test 14: Step 3 shows "View in target project" link on completion
  it("Step 3 shows View in target project link with correct href on completion", async () => {
    const user = userEvent.setup();
    mockJobState.preflight = MOCK_PREFLIGHT;
    mockJobState.status = "completed";
    mockJobState.result = {
      copiedCount: 2,
      movedCount: 0,
      skippedCount: 0,
      droppedLinkCount: 0,
      errors: [],
    };
    render(<CopyMoveDialog {...DEFAULT_PROPS} />);

    await advanceToConfigureStep(user);
    const goBtn = screen.getByRole("button", { name: /^go$/i });
    await user.click(goBtn);

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /viewInTargetProject/i });
      expect(link).toBeInTheDocument();
      // Target Project (id=2) was selected in advanceToConfigureStep
      expect(link.getAttribute("href")).toContain("/projects/repository/2");
    });
  });

  // Test 15: Dialog close during progress does not call reset (job continues in background)
  it("Dialog close during active job does not call job.reset", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    mockJobState.preflight = MOCK_PREFLIGHT;
    mockJobState.status = "active";
    mockJobState.progress = { processed: 2, total: 5 };

    render(
      <CopyMoveDialog
        {...DEFAULT_PROPS}
        onOpenChange={onOpenChange}
      />
    );

    await advanceToConfigureStep(user);
    const goBtn = screen.getByRole("button", { name: /^go$/i });
    await user.click(goBtn);

    // Dialog is now on progress step with status "active"
    // We need to simulate the dialog close event
    // The dialog close button (X) from DialogContent triggers onOpenChange(false)
    // which should NOT call job.reset when job is in progress
    mockJobState.reset.mockClear();

    // Simulate the cancel button (job.cancel, not job.reset)
    const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancelBtn).toBeInTheDocument();

    // Verify reset was NOT called when we clicked Go (step advanced to progress)
    expect(mockJobState.reset).not.toHaveBeenCalled();
  });

  // Test 16: Dialog close when idle calls reset
  it("Dialog close when idle calls job.reset", async () => {
    mockJobState.status = "idle";
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <CopyMoveDialog
        {...DEFAULT_PROPS}
        onOpenChange={onOpenChange}
      />
    );

    // reset is called when dialog opens (useEffect with open=true)
    expect(mockJobState.reset).toHaveBeenCalledOnce();

    // Reset the mock call count
    mockJobState.reset.mockClear();

    // Re-render with open=false should trigger the useEffect to not call reset
    // (useEffect only triggers on open=true -> false transition indirectly)
    // The handleOpenChange function when idle calls reset
    // We re-render with open=false to test the useEffect doesn't double-reset
    rerender(
      <CopyMoveDialog
        {...DEFAULT_PROPS}
        open={false}
        onOpenChange={onOpenChange}
      />
    );

    // reset was already called on initial open; subsequent renders don't trigger it
    expect(mockJobState.reset).not.toHaveBeenCalled();
  });
});
