import fs from "fs";
import path from "path";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Structural guard: the drag-drop provider must wrap the list from OUTSIDE.
 *
 * `RequirementsListView` calls react-dnd's `useDrop` during its own render.
 * If that same component also renders `<SimpleDndProvider>` in its own
 * returned JSX, the hook runs before the provider exists in the tree and
 * react-dnd throws "Invariant Violation: Expected drag drop context" —
 * a hard 500 on the requirements page.
 *
 * That shipped once (against the earlier react-arborist tree this component
 * replaced). Every component test passed and `tsc` was clean, because that
 * component's own test mocked BOTH `react-dnd` and `SimpleDndProvider` —
 * correctly, since jsdom cannot drive real HTML5 drag choreography — which
 * stubbed out the only thing that actually broke.
 *
 * A render-based guard is not viable here: mounting the real workspace pulls
 * in the resizable panel group unmocked and exhausts the JS heap. So this
 * asserts the invariant on the source text instead, which is what the bug
 * actually was — a nesting mistake, not a behavioural one.
 */
const DIR = path.join(
  process.cwd(),
  "app/[locale]/projects/requirements/[projectId]"
);

/**
 * Comments in both files legitimately *name* these components while
 * explaining the nesting rule — `RequirementsWorkspace.tsx`'s own doc block
 * contains the literal text `<RequirementsListView />`. Matching raw source
 * would read those mentions as real JSX and invert the position check, so
 * strip comments first and assert only against code.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const listSource = codeOnly(
  fs.readFileSync(path.join(DIR, "RequirementsListView.tsx"), "utf8")
);
const workspaceSource = codeOnly(
  fs.readFileSync(path.join(DIR, "RequirementsWorkspace.tsx"), "utf8")
);

describe("requirements drag-drop context nesting (structural)", () => {
  it("the list consumes a drag-drop context it does not provide itself", () => {
    // Precondition: if this component ever stops calling useDrop, this whole
    // guard is moot and should be revisited rather than silently passing.
    expect(listSource).toContain("useDrop");

    expect(listSource).not.toMatch(/<SimpleDndProvider[\s>]/);
  });

  it("the workspace provides the drag-drop context around the list", () => {
    expect(workspaceSource).toMatch(/<SimpleDndProvider[\s>]/);

    // The provider must actually enclose the list, not merely appear
    // somewhere in the same file.
    const open = workspaceSource.indexOf("<SimpleDndProvider");
    const mount = workspaceSource.indexOf("<RequirementsListView");
    const close = workspaceSource.indexOf("</SimpleDndProvider>");

    expect(open).toBeGreaterThanOrEqual(0);
    expect(mount).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(mount);
  });
});

// --- Phase 26: traceability export action + requirements-enabled gate ---
//
// RequirementsListView and RequirementDetailPanel are stubbed here for the
// same JS-heap-exhaustion reason the structural guard above documents (the
// real DataTable/virtualizer stack is heavy in jsdom) — NOT to hide the
// drag-drop nesting invariant, which the structural tests above cover
// unmocked, on source text, and stay green and untouched. The header's
// Snapshots menu is stubbed the same way (see its own suite).
const { projectFlags, mockToastError } = vi.hoisted(() => ({
  projectFlags: {
    requirementsEnabled: true,
    // Left undefined by default so the mocked query result has no
    // `isPending` field at all -- matching the shape the four pre-existing
    // cases below were written against. A test that needs the pending gate
    // sets this explicitly.
    isPending: undefined as boolean | undefined,
  },
  mockToastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

// `~/lib/navigation`'s `Link` is next-intl's shared-navigation Link: it calls
// the REAL `useLocale()` and throws "No intl context found" without a
// provider, whatever `next-intl` itself is mocked to. The requirement detail
// panel and breadcrumb render it, so it needs the same plain-anchor stub
// `RequirementsListColumns.test.tsx` and `RequirementCoveragePanel.test.tsx`
// already use for this primitive.
// Selection moved into the URL (`?requirement=<id>`), so the panel renders
// only when that param is present. Seeded here to the id the list stub
// selects, which is what the pre-refactor `useState` selection gave these
// tests for free.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("requirement=1"),
}));

const mockRouterPush = vi.hoisted(() => vi.fn());
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
    push: mockRouterPush,
  }),
  usePathname: () => "/projects/requirements/42",
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Test User" } } }),
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: vi.fn() },
}));

// Saved traceability snapshots the header's Export PDF menu lists; empty
// by default so the menu trigger is absent unless a test opts in.
let mockSnapshotRows: Array<{ id: number; name: string; capturedAt: string }> =
  [];

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    requirementTraceabilitySnapshot: {
      useFindMany: () => ({ data: mockSnapshotRows }),
    },
    projects: {
      useFindUnique: () => ({
        // Real TanStack Query has no `data` while `isPending` is true --
        // mirror that here so the pending case actually exercises the gate
        // reading `isPending` rather than an incidental data shape.
        data:
          projectFlags.isPending === true
            ? undefined
            : {
                requirementsEnabled: projectFlags.requirementsEnabled,
                name: "Mock Project",
                iconUrl: null,
              },
        // Only present when a test opts in -- see the hoisted default above.
        ...(projectFlags.isPending !== undefined
          ? { isPending: projectFlags.isPending }
          : {}),
      }),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

// The real models module derives its enums from the (mocked-empty) schema
// above; the workspace only needs the one area it gates Save Snapshot on.
vi.mock("~/zenstack/models", () => ({
  ApplicationArea: { Reporting: "Reporting" },
}));

// A stub so the header assertion pins WHICH help key renders without
// dragging react-markdown + Radix Popover into this suite.
vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: ({ helpKey }: { helpKey: string }) => (
    <div data-testid="mock-help-popover" data-help-key={helpKey} />
  ),
}));

let mockIsProjectAdmin = true;
// The Reporting-area bit the Save Snapshot button reads; off by default.
let mockReportingCanAddEdit = false;
let mockReportingCanDelete = false;
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: (_projectId: unknown, area?: string) => ({
    permissions:
      area === "Reporting"
        ? {
            canAddEdit: mockReportingCanAddEdit,
            canDelete: mockReportingCanDelete,
            canClose: false,
          }
        : null,
    isProjectAdmin: mockIsProjectAdmin,
    isLoading: false,
  }),
}));

// The header's Snapshots menu is its own component with its own suite;
// here it is a stub that exposes the props the workspace wires into it.
const capturedSnapshotMenuProps: { current: any } = { current: null };
vi.mock("@/components/reports/RequirementSnapshotHeaderMenu", () => ({
  RequirementSnapshotHeaderMenu: (props: any) => {
    capturedSnapshotMenuProps.current = props;
    return (
      <>
        <button data-testid="mock-snapshots-menu" />
        <button
          data-testid="mock-snapshots-menu-open"
          onClick={() => props.onOpen(12)}
        />
      </>
    );
  },
}));

// Same seam RequirementCoveragePanel.test.tsx uses: Radix's Tooltip.Root
// works standalone, but stubbing it keeps these assertions about the
// export action itself, not Radix's hover/open-state timing.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// The action bar's Add Requirement button (gap closure 26.2-16, UAT gap 13)
// reaches the list's dialog through a ref -- the mock must be `forwardRef`
// so passing `ref={listViewRef}` in the real component doesn't warn, and so
// a test can assert the button actually drives `openCreateRoot`. The mock
// also adds `openDeleteDialog` to the same handle, and captures the props
// the real list receives (`onSelectRequirement`) so a test can drive a
// selection -- the mock renders a plain button wired to it, since nothing
// else in this file can trigger `setSelectedRequirementId` on the real
// workspace.
const mockOpenCreateRoot = vi.fn();
const mockOpenDeleteDialog = vi.fn();
vi.mock("./RequirementsListView", () => ({
  default: React.forwardRef(function MockRequirementsListView(props: any, ref) {
    React.useImperativeHandle(ref, () => ({
      openCreateRoot: mockOpenCreateRoot,
      openDeleteDialog: mockOpenDeleteDialog,
    }));
    return (
      <div data-testid="mock-requirements-list-view">
        <button
          type="button"
          data-testid="mock-select-requirement"
          onClick={() => props.onSelectRequirement(1)}
        >
          select
        </button>
        <button
          type="button"
          data-testid="mock-request-edit"
          onClick={() => props.onRequestEdit?.(1)}
        >
          edit
        </button>
      </div>
    );
  }),
}));

// Captures every render's props so a test can assert what the workspace
// hands the panel (including `onRequestDelete`), without needing the real
// panel's own heavy ZenStack surface.
const capturedDetailPanelProps: any[] = [];
vi.mock("@/components/requirements/RequirementDetailsPanel", () => ({
  RequirementDetailsPanel: (props: any) => {
    capturedDetailPanelProps.push(props);
    return <div data-testid="mock-requirement-detail-panel" />;
  },
}));

import RequirementsWorkspace from "./RequirementsWorkspace";

describe("requirements tree pane collapse toggle (structural)", () => {
  // Ported from ProjectRepository.tsx's folder-tree toggle (operator request
  // 2026-08-25). Rendering the real workspace exhausts the jsdom heap (see
  // the header comment), so the wiring is pinned on source text, matching
  // this file's established idiom.
  it("the tree panel is collapsible and driven by an imperative handle", () => {
    expect(workspaceSource).toContain("PanelImperativeHandle");
    expect(workspaceSource).toMatch(
      /id="requirements-tree"[\s\S]*?collapsible/
    );
    expect(workspaceSource).toContain("collapsedSize={0}");
    expect(workspaceSource).toContain("treePanelRef.current");
  });

  it("a toggle button flips the chevron and calls expand/collapse", () => {
    expect(workspaceSource).toContain("requirements-tree-collapse-toggle");
    expect(workspaceSource).toMatch(
      /isTreeCollapsed\s*\?\s*<ChevronRight\s*\/>\s*:\s*<ChevronLeft\s*\/>/
    );
    expect(workspaceSource).toMatch(/panel\.expand\(\)/);
    expect(workspaceSource).toMatch(/panel\.collapse\(\)/);
  });
});

describe("RequirementsWorkspace (Phase 26 coverage additions)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFlags.requirementsEnabled = true;
    projectFlags.isPending = undefined;
    mockIsProjectAdmin = true;
    capturedDetailPanelProps.length = 0;
  });

  it("renders the requirements-disabled notice instead of the workspace when the project flag is off", () => {
    projectFlags.requirementsEnabled = false;

    render(<RequirementsWorkspace projectId="42" />);

    // Presence: the disabled notice.
    expect(screen.getByTestId("requirements-disabled-notice")).not.toBeNull();

    // Absence: neither the list, the detail pane, nor the export action —
    // a bookmarked URL on a project with the feature off must not reach
    // any of them.
    expect(screen.queryByTestId("requirements-tree-pane")).toBeNull();
    expect(screen.queryByTestId("mock-requirements-list-view")).toBeNull();
    expect(screen.queryByTestId("requirements-detail-pane")).toBeNull();
    expect(screen.queryByTestId("mock-snapshots-menu")).toBeNull();
    expect(screen.queryByTestId("requirements-tree-add-root")).toBeNull();
  });

  // Gap closure 26.2-16 (UAT gap 13): the root-level Add Requirement trigger
  // moved out of the list toolbar into the page's action bar, after Export
  // PDF, using the same button-group idiom the milestone detail page's
  // header uses.
  describe("action bar Add Requirement (gap closure 26.2-16, UAT gap 13)", () => {
    it("renders the Snapshots menu then Add Requirement, in that order", () => {
      render(<RequirementsWorkspace projectId="42" />);

      const exportButton = screen.getByTestId("mock-snapshots-menu");
      const addButton = screen.getByTestId("requirements-tree-add-root");
      expect(addButton.textContent).toContain("requirements.tree.addRoot");

      const position =
        exportButton.compareDocumentPosition(addButton) &
        Node.DOCUMENT_POSITION_FOLLOWING;
      expect(position).toBeTruthy();
    });

    it("clicking Add Requirement opens the list's root-create dialog through the ref", () => {
      render(<RequirementsWorkspace projectId="42" />);

      fireEvent.click(screen.getByTestId("requirements-tree-add-root"));

      expect(mockOpenCreateRoot).toHaveBeenCalledTimes(1);
    });

    it("hides the Add Requirement button for a non-admin viewer", () => {
      mockIsProjectAdmin = false;

      render(<RequirementsWorkspace projectId="42" />);

      expect(screen.getByTestId("mock-snapshots-menu")).not.toBeNull();
      expect(screen.queryByTestId("requirements-tree-add-root")).toBeNull();
    });
  });

  // Gap closure (26.2-08, gap 1): the requirementsEnabled read used to be a
  // two-state ternary, so a project with the feature ON would flash the
  // disabled notice for one render while the query was still pending. These
  // two cases pin the three-state gate that replaced it.
  it("shows a loading placeholder, not the disabled notice or the action bar, while the flag query is pending", () => {
    projectFlags.isPending = true;

    render(<RequirementsWorkspace projectId="42" />);

    const loading = screen.getByTestId("requirements-gate-loading");
    expect(loading).not.toBeNull();
    // Same height box the enabled and disabled branches use, so the card
    // does not jump height once the flag resolves.
    expect(loading.className).toContain("h-[calc(100vh-14rem)]");
    expect(loading.className).toContain("min-h-[400px]");

    // Fail closed: neither the disabled notice nor the action bar (which
    // would otherwise let an operator act on a feature not yet known to be
    // on) may render before the query resolves.
    expect(screen.queryByTestId("requirements-disabled-notice")).toBeNull();
    expect(screen.queryByTestId("mock-snapshots-menu")).toBeNull();
  });

  it("renders the disabled notice, not the loading placeholder, once the query resolves with the flag off", () => {
    projectFlags.requirementsEnabled = false;
    projectFlags.isPending = false;

    render(<RequirementsWorkspace projectId="42" />);

    expect(screen.getByTestId("requirements-disabled-notice")).not.toBeNull();
    expect(screen.queryByTestId("requirements-gate-loading")).toBeNull();
  });

  // A requirement can be deleted from the detail panel, not only from the
  // list's own row action -- "just like test cases". The panel holds no
  // delete logic of its own (no fetch, no mutation, no descendant count);
  // it opens the SAME dialog the row action opens, through this ref.
  describe("delete handler wiring", () => {
    it("hands the detail panel a delete handler that opens the list's delete dialog", () => {
      render(<RequirementsWorkspace projectId="42" />);

      fireEvent.click(screen.getByTestId("mock-select-requirement"));

      expect(
        screen.getByTestId("mock-requirement-detail-panel")
      ).toBeInTheDocument();
      const lastProps = capturedDetailPanelProps.at(-1);
      expect(lastProps.requirementId).toBe(1);
      expect(typeof lastProps.onRequestDelete).toBe("function");

      lastProps.onRequestDelete();
      expect(mockOpenDeleteDialog).toHaveBeenCalledWith(1);
    });

    it("does not hand the detail panel a delete handler for a non-admin viewer", () => {
      mockIsProjectAdmin = false;

      render(<RequirementsWorkspace projectId="42" />);

      fireEvent.click(screen.getByTestId("mock-select-requirement"));

      const lastProps = capturedDetailPanelProps.at(-1);
      expect(lastProps.onRequestDelete).toBeUndefined();
    });
  });

  describe("page header convention", () => {
    it("carries the help popover and the project name below the title, like every other page header", () => {
      render(<RequirementsWorkspace projectId="42" />);

      const help = screen.getByTestId("mock-help-popover");
      expect(help.getAttribute("data-help-key")).toBe("projectRequirements");
      expect(
        screen.getByTestId("requirements-page-header").textContent
      ).toContain("Mock Project");
    });
  });

  describe("row-menu Edit request", () => {
    it("selects the row and hands the panel a tokened edit request", () => {
      render(<RequirementsWorkspace projectId="42" />);

      fireEvent.click(screen.getByTestId("mock-request-edit"));

      const lastProps = capturedDetailPanelProps.at(-1);
      expect(lastProps.requirementId).toBe(1);
      expect(lastProps.editRequest).toEqual({ id: 1, token: 1 });
    });

    it("bumps the token on every request so the panel can re-enter edit mode after a cancel", () => {
      render(<RequirementsWorkspace projectId="42" />);

      fireEvent.click(screen.getByTestId("mock-request-edit"));
      fireEvent.click(screen.getByTestId("mock-request-edit"));

      const lastProps = capturedDetailPanelProps.at(-1);
      expect(lastProps.editRequest).toEqual({ id: 1, token: 2 });
    });
  });
});

describe("traceability snapshots in the workspace header", () => {
  beforeEach(() => {
    mockReportingCanAddEdit = false;
    mockReportingCanDelete = false;
    mockIsProjectAdmin = true;
    capturedSnapshotMenuProps.current = null;
  });

  it("mounts the Snapshots menu with the viewer's Reporting rights", () => {
    render(<RequirementsWorkspace projectId="42" />);
    expect(screen.getByTestId("mock-snapshots-menu")).not.toBeNull();
    expect(capturedSnapshotMenuProps.current).toMatchObject({
      projectId: 42,
      canManage: false,
      canDelete: false,
    });
  });

  it("grants capture and delete from the Reporting area bits, not project-admin", () => {
    mockReportingCanAddEdit = true;
    mockReportingCanDelete = true;
    mockIsProjectAdmin = false;
    render(<RequirementsWorkspace projectId="42" />);
    expect(capturedSnapshotMenuProps.current).toMatchObject({
      canManage: true,
      canDelete: true,
    });
  });

  it("opens a chosen snapshot in the traceability report with its id", () => {
    mockRouterPush.mockReset();
    render(<RequirementsWorkspace projectId="42" />);
    fireEvent.click(screen.getByTestId("mock-snapshots-menu-open"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/projects/reports/42?reportType=requirement-traceability&snapshotId=12"
    );
  });

  it("hides the menu with the rest of the action bar when requirements are off", () => {
    projectFlags.requirementsEnabled = false;
    render(<RequirementsWorkspace projectId="42" />);
    expect(screen.queryByTestId("mock-snapshots-menu")).toBeNull();
  });
});
