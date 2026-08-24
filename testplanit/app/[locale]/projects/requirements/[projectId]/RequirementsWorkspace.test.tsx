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
// unmocked, on source text, and stay green and untouched.
// `useExportRequirementTraceabilityPdf`
// is stubbed so these tests exercise the workspace's own wiring (which
// action renders where, disabled state, the opt-in gate) rather than
// re-proving the hook's own PDF-rendering behavior, already covered by
// useExportRequirementTraceabilityPdf.test.ts.
const { mockUseExportPdf, projectFlags, mockToastError } = vi.hoisted(() => ({
  mockUseExportPdf: vi.fn(),
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

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Test User" } } }),
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: vi.fn() },
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useFindUnique: () => ({
        // Real TanStack Query has no `data` while `isPending` is true --
        // mirror that here so the pending case actually exercises the gate
        // reading `isPending` rather than an incidental data shape.
        data:
          projectFlags.isPending === true
            ? undefined
            : { requirementsEnabled: projectFlags.requirementsEnabled },
        // Only present when a test opts in -- see the hoisted default above.
        ...(projectFlags.isPending !== undefined
          ? { isPending: projectFlags.isPending }
          : {}),
      }),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("~/hooks/pdf/useExportRequirementTraceabilityPdf", () => ({
  useExportRequirementTraceabilityPdf: mockUseExportPdf,
}));

let mockIsProjectAdmin = true;
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: null,
    isProjectAdmin: mockIsProjectAdmin,
    isLoading: false,
  }),
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
// a test can assert the button actually drives `openCreateRoot`.
const mockOpenCreateRoot = vi.fn();
vi.mock("./RequirementsListView", () => ({
  default: React.forwardRef(function MockRequirementsListView(_props, ref) {
    React.useImperativeHandle(ref, () => ({
      openCreateRoot: mockOpenCreateRoot,
    }));
    return <div data-testid="mock-requirements-list-view" />;
  }),
}));

vi.mock("./RequirementDetailPanel", () => ({
  default: () => <div data-testid="mock-requirement-detail-panel" />,
}));

import RequirementsWorkspace from "./RequirementsWorkspace";

describe("RequirementsWorkspace (Phase 26 coverage additions)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFlags.requirementsEnabled = true;
    projectFlags.isPending = undefined;
    mockIsProjectAdmin = true;
    mockUseExportPdf.mockReturnValue({
      isExporting: false,
      handleExport: vi.fn(),
    });
  });

  it("offers a traceability PDF export action in the workspace header", () => {
    render(<RequirementsWorkspace projectId="42" />);

    const action = screen.getByTestId("requirements-export-pdf");
    expect(action).not.toBeNull();
    expect(action.textContent).toContain("common.actions.exportPdf");
    expect(action.hasAttribute("disabled")).toBe(false);
  });

  it("disables the export action while an export is running", () => {
    mockUseExportPdf.mockReturnValue({
      isExporting: true,
      handleExport: vi.fn(),
    });

    render(<RequirementsWorkspace projectId="42" />);

    const action = screen.getByTestId("requirements-export-pdf");
    expect(action.hasAttribute("disabled")).toBe(true);
    expect(action.textContent).toContain("common.actions.exportingPdf");
    expect(action.className).toContain("animate-pulse");
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
    expect(screen.queryByTestId("requirements-export-pdf")).toBeNull();
    expect(screen.queryByTestId("requirements-tree-add-root")).toBeNull();
  });

  // Gap closure 26.2-16 (UAT gap 13): the root-level Add Requirement trigger
  // moved out of the list toolbar into the page's action bar, after Export
  // PDF, using the same button-group idiom the milestone detail page's
  // header uses.
  describe("action bar Add Requirement (gap closure 26.2-16, UAT gap 13)", () => {
    it("renders Export PDF then Add Requirement, in that order", () => {
      render(<RequirementsWorkspace projectId="42" />);

      const exportButton = screen.getByTestId("requirements-export-pdf");
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

      expect(screen.getByTestId("requirements-export-pdf")).not.toBeNull();
      expect(screen.queryByTestId("requirements-tree-add-root")).toBeNull();
    });
  });

  // Gap closure (26.2-08, gap 1): the requirementsEnabled read used to be a
  // two-state ternary, so a project with the feature ON would flash the
  // disabled notice for one render while the query was still pending. These
  // two cases pin the three-state gate that replaced it.
  it("shows a loading placeholder, not the disabled notice or the export action, while the flag query is pending", () => {
    projectFlags.isPending = true;

    render(<RequirementsWorkspace projectId="42" />);

    const loading = screen.getByTestId("requirements-gate-loading");
    expect(loading).not.toBeNull();
    // Same height box the enabled and disabled branches use, so the card
    // does not jump height once the flag resolves.
    expect(loading.className).toContain("h-[calc(100vh-14rem)]");
    expect(loading.className).toContain("min-h-[400px]");

    // Fail closed: neither the disabled notice nor the export action (which
    // would otherwise let an operator export a feature not yet known to be
    // on) may render before the query resolves.
    expect(screen.queryByTestId("requirements-disabled-notice")).toBeNull();
    expect(screen.queryByTestId("requirements-export-pdf")).toBeNull();
  });

  it("renders the disabled notice, not the loading placeholder, once the query resolves with the flag off", () => {
    projectFlags.requirementsEnabled = false;
    projectFlags.isPending = false;

    render(<RequirementsWorkspace projectId="42" />);

    expect(screen.getByTestId("requirements-disabled-notice")).not.toBeNull();
    expect(screen.queryByTestId("requirements-gate-loading")).toBeNull();
  });

  // Additive coverage (not one of the three scaffolded titles): the plan's
  // <behavior> block and hard_rules both require a rejected export to
  // surface a localized toast rather than fail silently.
  it("shows a localized error toast when the export fails", () => {
    let onError: ((error: unknown) => void) | undefined;
    mockUseExportPdf.mockImplementation((props: any) => {
      onError = props.onError;
      return { isExporting: false, handleExport: vi.fn() };
    });

    render(<RequirementsWorkspace projectId="42" />);

    expect(onError).toBeTypeOf("function");
    onError!(new Error("network down"));

    expect(mockToastError).toHaveBeenCalledWith(
      "requirements.export.exportFailed"
    );
  });
});
