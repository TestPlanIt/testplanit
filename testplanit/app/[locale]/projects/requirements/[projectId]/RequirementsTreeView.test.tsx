import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Backs the mocked react-arborist `Tree` so tests can both inspect the raw
// `data` prop RequirementsTreeView's own `buildTree` produced (the tree
// shape assertions test *that* output, not the library's own rendering --
// see the file-level note below) and observe a toggle click reach a real
// node without touching the network.
const { toggleSpies } = vi.hoisted(() => ({
  toggleSpies: new Map<string, ReturnType<typeof vi.fn>>(),
}));

const { useFindManyIssueMock } = vi.hoisted(() => ({
  useFindManyIssueMock: vi.fn(
    (_args?: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
    }): {
      data: Record<string, unknown>[];
      isLoading: boolean;
      error: unknown;
      refetch: () => void;
    } => ({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
  ),
}));

// HIER-02's create/rename hooks. Both default to a resolved mutateAsync so
// tests that don't care about the create/rename path (the drag-and-drop
// suite above) never have to stub them individually.
const { useCreateIssueMock, useUpdateIssueMock } = vi.hoisted(() => ({
  useCreateIssueMock: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
  })),
  useUpdateIssueMock: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useFindMany: useFindManyIssueMock,
      useCreate: useCreateIssueMock,
      useUpdate: useUpdateIssueMock,
    },
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "test-user-1" } } }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mutable so "disables drag when the viewer cannot edit the project" can
// flip it false for one test, mirroring RequirementProvenanceBadge.test.tsx's
// own established `mockIsProjectAdmin` convention for the same hook.
let mockIsProjectAdmin = true;
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: null,
    isProjectAdmin: mockIsProjectAdmin,
    isLoading: false,
  }),
}));

// Mocked at the module boundary per 26-VALIDATION.md's testing standard --
// this is the seam a rejecting coverage request needs to be expressible
// through. `coverageFor` is NOT reimplemented here: `importOriginal` keeps
// the real `String(id)`-indexing helper so these tests exercise the same
// logic production does, and `RequirementCoverageBadge` itself is never
// mocked -- the indicator's presence and absence is the thing under test.
const { useRequirementCoverageMock } = vi.hoisted(() => ({
  useRequirementCoverageMock: vi.fn(() => ({
    data: undefined as unknown,
    isError: false,
  })),
}));
vi.mock("~/hooks/useRequirementCoverage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/hooks/useRequirementCoverage")>();
  return {
    ...actual,
    useRequirementCoverage: useRequirementCoverageMock,
  };
});

// react-dnd's real DndProvider/useDrop needs no jsdom drag choreography for
// these tests -- only the bottom-drop-zone spec object react-dnd's `useDrop`
// is handed. Capture it directly rather than trying to simulate a real HTML5
// drag-and-drop sequence (unassertable in jsdom; see the file-level note in
// RequirementsTreeView.tsx's own reparent section).
const { dropSpecRef } = vi.hoisted(() => ({
  dropSpecRef: { current: null as any },
}));

vi.mock("react-dnd", () => ({
  // Stands in for the manager the real SimpleDndProvider supplies. The
  // component passes this straight through to <Tree> so react-arborist reuses
  // it instead of standing up a second HTML5 backend; nothing here calls into
  // it, so an opaque sentinel is enough.
  useDragDropManager: () => ({ __mockDndManager: true }),
  useDrop: (specFactory: () => any) => {
    dropSpecRef.current = specFactory();
    return [{ isOverBottom: false }, vi.fn()];
  },
}));

vi.mock("@/components/ui/SimpleDndProvider", () => ({
  SimpleDndProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock react-arborist's Tree with a thin, controlled render: TreeView.tsx's
// own test file (app/[locale]/projects/repository/[projectId]/TreeView.test.tsx)
// already established this is the reliable way to exercise this library in
// jsdom for this codebase, so RequirementsTreeView follows the same
// precedent rather than fighting react-window's real virtualization in a
// test environment. Depth/multi-root shape assertions read the `data` prop
// captured on each `Tree` call instead of trying to render nested rows --
// this mock only renders the top-level nodes it is handed, exactly like the
// TreeView.tsx reference mock does.
vi.mock("react-arborist", () => ({
  Tree: vi.fn(
    ({
      data,
      children: NodeRenderer,
      onSelect,
    }: {
      data: any[];
      children: React.ComponentType<any>;
      onSelect?: (nodes: any[]) => void;
    }) => (
      <div data-testid="arborist-tree">
        {data.map((node: any) => {
          let toggleSpy = toggleSpies.get(node.id);
          if (!toggleSpy) {
            toggleSpy = vi.fn();
            toggleSpies.set(node.id, toggleSpy);
          }
          return (
            <NodeRenderer
              key={node.id}
              node={{
                id: node.id,
                data: { name: node.name, data: node.data },
                isSelected: false,
                isOpen: false,
                children: node.children || [],
                select: () =>
                  onSelect?.([{ id: node.id, data: { data: node.data } }]),
                toggle: toggleSpy,
              }}
              style={{}}
            />
          );
        })}
      </div>
    )
  ),
}));

import { Tree } from "react-arborist";
import { toast } from "sonner";
import RequirementsTreeView from "./RequirementsTreeView";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

function makeRequirement(overrides: Partial<Record<string, any>>) {
  return {
    id: 1,
    name: "Requirement",
    title: "Requirement",
    parentId: null,
    projectId: 42,
    isDeleted: false,
    isRequirement: true,
    integrationId: null,
    requirementDetachedAt: null,
    externalKey: null,
    externalUrl: null,
    issueTypeIconUrl: null,
    ...overrides,
  };
}

// A five-level chain (root -> ... -> id 5) plus an independent second root
// (id 10), so the depth/multi-root behavior has real fixture support.
const deepChainAndSecondRoot = [
  makeRequirement({ id: 1, name: "Root A", parentId: null }),
  makeRequirement({ id: 2, name: "Child A1", parentId: 1 }),
  makeRequirement({ id: 3, name: "Grandchild A1a", parentId: 2 }),
  makeRequirement({ id: 4, name: "Great-grandchild A1a-i", parentId: 3 }),
  makeRequirement({
    id: 5,
    name: "Great-great-grandchild A1a-i-x",
    parentId: 4,
  }),
  makeRequirement({ id: 10, name: "Root B", parentId: null }),
];

function findNodeById(nodes: any[], id: string): any {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Builds a `RequirementCoverageResponse`-shaped fixture, string-keyed the
 *  way the real route's `Object.fromEntries` serialization requires. */
function makeCoverageResponse(
  entries: Record<number, Partial<Record<string, unknown>>>
) {
  const coverage: Record<string, unknown> = {};
  Object.entries(entries).forEach(([id, overrides]) => {
    coverage[id] = {
      linkedCaseCount: 0,
      crossProjectCaseCount: 0,
      passed: 0,
      failed: 0,
      inProgress: 0,
      notRun: 0,
      uncovered: false,
      status: "NOT_RUN",
      ...overrides,
    };
  });
  return { projectId: 42, coverage };
}

/** Opens a Radix DropdownMenu trigger -- fireEvent.click alone doesn't
 *  dispatch the pointerdown/pointerup sequence Radix listens for in jsdom.
 *  Mirrors RequirementProvenanceBadge.test.tsx's identical helper. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 });
}

describe("RequirementsTreeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toggleSpies.clear();
    dropSpecRef.current = null;
    mockIsProjectAdmin = true;
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
    useFindManyIssueMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    useCreateIssueMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
    });
    useUpdateIssueMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    });
    useRequirementCoverageMock.mockReturnValue({
      data: undefined,
      isError: false,
    });
  });

  it("renders every requirement for the project as a node, at arbitrary depth", () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    const treeData = lastCall[0].data as any[];

    // Every one of the six fixture rows must be reachable somewhere in the
    // built tree, and the deepest one (id 5) sits four hops below its root
    // (id 1) -- depth greater than 3.
    const allIds = ["1", "2", "3", "4", "5", "10"];
    allIds.forEach((id) => {
      expect(findNodeById(treeData, id)).not.toBeNull();
    });

    const grandGrandChild = findNodeById(treeData, "5");
    expect(grandGrandChild?.data?.parentId).toBe(4);
    const child = findNodeById(treeData, "2");
    expect(child?.data?.parentId).toBe(1);
  });

  it("queries with the shared REQUIREMENT_SCOPE_WHERE predicate and excludes soft-deleted rows", () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const call = useFindManyIssueMock.mock.calls[0][0] as { where: any };
    expect(call.where.isDeleted).toBe(false);
    expect(call.where.isRequirement).toBe(true);
    expect(call.where.projectId).toBe(42);
  });

  it("renders multiple independent root trees side by side", () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    const treeData = lastCall[0].data as any[];
    const rootIds = treeData.map((node: any) => node.id).sort();
    expect(rootIds).toEqual(["1", "10"]);
  });

  it("expands and collapses a node without issuing a network request", () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const callsBefore = useFindManyIssueMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("requirement-node-1"));

    expect(toggleSpies.get("1")).toHaveBeenCalledTimes(1);
    expect(useFindManyIssueMock.mock.calls.length).toBe(callsBefore);
  });

  it("selecting a node surfaces that requirement in the detail panel", () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const onSelectRequirement = vi.fn();

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={onSelectRequirement}
      />
    );

    fireEvent.click(screen.getByTestId("requirement-node-10"));

    expect(onSelectRequirement).toHaveBeenCalledWith(10);
  });

  it("posts the dragged node and its new parent to the reparent route rather than writing parentId directly", async () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    const onMove = lastCall[0].onMove;
    expect(onMove).toBeDefined();

    // Drag requirement id 2 (Child A1) onto id 10 (Root B) as its new parent
    // -- the exact node-onto-node gesture react-arborist's own onMove
    // callback owns, with no ambiguous Move/Copy choice to make.
    await onMove!({
      dragIds: ["2"],
      dragNodes: [],
      parentId: "10",
      parentNode: null,
      index: 0,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/42/requirements/2/reparent",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: 10 }),
      })
    );
  });

  it("dropping onto the bottom zone reparents the node to the root level", async () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    expect(dropSpecRef.current).toBeTruthy();
    expect(dropSpecRef.current.accept).toBe("NODE");

    // Node id 3 (Grandchild A1a) dropped on the root zone -- parentId: null
    // is a first-class root-level move, not a skipped call.
    await dropSpecRef.current.drop({ id: "3", dragIds: ["3"] });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/42/requirements/3/reparent",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ parentId: null }),
      })
    );
  });

  it("surfaces a server-rejected reparent as an error toast and leaves the tree unchanged", async () => {
    const refetchSpy = vi.fn();
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: refetchSpy,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Cannot move a requirement under its own descendant",
      }),
    }) as any;

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    const onMove = lastCall[0].onMove;

    await onMove!({
      dragIds: ["1"],
      dragNodes: [],
      parentId: "5",
      parentNode: null,
      index: 0,
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Cannot move a requirement under its own descendant"
      )
    );
    // The server rejected the move, so the tree must reconcile from the
    // persisted truth rather than trust react-arborist's own optimistic
    // internal state -- a refetch, never a manual client-side revert.
    expect(refetchSpy).toHaveBeenCalled();
  });

  it("disables drag when the viewer cannot edit the project", () => {
    mockIsProjectAdmin = false;
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    expect(lastCall[0].onMove).toBeUndefined();
    expect(lastCall[0].disableDrag).toBe(true);
    expect(lastCall[0].disableDrop).toBe(true);
  });

  it("creates a native requirement with isRequirement true and the selected parentId", async () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const mutateAsync = vi.fn().mockResolvedValue({ id: 99 });
    useCreateIssueMock.mockReturnValue({ mutateAsync });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    // Root create, via the toolbar's "Add Requirement" button.
    fireEvent.click(screen.getByTestId("requirements-tree-add-root"));
    fireEvent.change(screen.getByTestId("create-requirement-name-input"), {
      target: { value: "New Root Requirement" },
    });
    fireEvent.click(screen.getByTestId("create-requirement-submit"));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    const rootPayload = mutateAsync.mock.calls[0][0].data;
    expect(rootPayload.isRequirement).toBe(true);
    expect(rootPayload.name).toBe("New Root Requirement");
    expect(rootPayload.title).toBe("New Root Requirement");
    expect(rootPayload.parent).toBeUndefined();

    // Child create, via node id 1's (Root A) row menu -- the selected
    // parentId is that node's own id, never written as a bare `null`.
    openMenu(screen.getByTestId("requirement-actions-trigger-1"));
    fireEvent.click(screen.getByTestId("requirement-action-add-child-1"));
    fireEvent.change(screen.getByTestId("create-requirement-name-input"), {
      target: { value: "New Child Requirement" },
    });
    fireEvent.click(screen.getByTestId("create-requirement-submit"));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(2);
    });
    const childPayload = mutateAsync.mock.calls[1][0].data;
    expect(childPayload.isRequirement).toBe(true);
    expect(childPayload.parent).toEqual({ connect: { id: 1 } });
  });

  it("renames a requirement in place through the ZenStack update hook", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useUpdateIssueMock.mockReturnValue({ mutateAsync });
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    // react-arborist's own commit path is `node.submit(value)` ->
    // `onRename({id, name, node})` -- invoke the captured `onRename` prop
    // directly, matching this file's established precedent for `onMove`
    // above (25-09) rather than trying to simulate `node.edit()`'s internal
    // isEditing state through the thin `Tree` mock.
    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    const onRename = lastCall[0].onRename;
    expect(onRename).toBeDefined();

    await onRename!({ id: "2", name: "Renamed Child", node: {} as any });

    expect(mutateAsync).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { name: "Renamed Child", title: "Renamed Child" },
    });
  });

  it("does not offer rename on a synced, non-detached requirement", () => {
    const lockedFixture = [
      ...deepChainAndSecondRoot,
      makeRequirement({
        id: 20,
        name: "Locked Requirement",
        parentId: null,
        integrationId: 9,
        requirementDetachedAt: null,
      }),
    ];
    useFindManyIssueMock.mockReturnValue({
      data: lockedFixture,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    openMenu(screen.getByTestId("requirement-actions-trigger-20"));
    const renameItem = screen.getByTestId("requirement-action-rename-20");
    expect(renameItem).toHaveAttribute("data-disabled");

    // A native (unlocked) row's rename item, by contrast, stays enabled.
    openMenu(screen.getByTestId("requirement-actions-trigger-1"));
    const nativeRenameItem = screen.getByTestId("requirement-action-rename-1");
    expect(nativeRenameItem).not.toHaveAttribute("data-disabled");
  });
});

// Test inventory scaffold for Phase 26's coverage indicator + uncovered
// filter additions to the tree (D-1, D-2). Titles only — converted by
// 26-06.
describe("RequirementsTreeView (Phase 26 coverage additions)", () => {
  it("renders a coverage indicator on every node once coverage has loaded", () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    // id 1 is a parent (has descendants) -- its indicator reflects the
    // rolled-up subtree the coverage route already computed server-side,
    // not a recomputation from the tree's own in-memory children.
    useRequirementCoverageMock.mockReturnValue({
      data: makeCoverageResponse({
        1: {
          linkedCaseCount: 7,
          passed: 3,
          failed: 1,
          notRun: 3,
          status: "FAILED",
        },
        10: { uncovered: true, status: "UNCOVERED" },
      }),
      isError: false,
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    expect(
      screen.getByTestId("requirement-coverage-failed")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-coverage-uncovered")
    ).toBeInTheDocument();
  });

  it("renders no coverage indicator and no error when the coverage request fails", () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    useRequirementCoverageMock.mockReturnValue({
      data: undefined,
      isError: true,
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    // Every node still renders...
    expect(screen.getByTestId("requirement-node-1")).toBeInTheDocument();
    expect(screen.getByTestId("requirement-node-10")).toBeInTheDocument();
    // ...but no indicator element and no error text anywhere: a coverage
    // outage must never read as a coverage gap.
    expect(screen.queryAllByTestId(/^requirement-coverage-/)).toHaveLength(0);
    expect(screen.queryByText(/coverage/i)).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("filters to only uncovered requirements when the toggle is on, keeping their ancestors visible", () => {
    // Root A is itself covered at the rollup level (its subtree has SOME
    // linked cases, via the covered child) even though one of its own
    // children has zero -- the realistic shape that makes "ancestor kept
    // for context" distinguishable from "parent is uncovered too".
    const fixture = [
      makeRequirement({ id: 1, name: "Root A", parentId: null }),
      makeRequirement({ id: 2, name: "Covered Child", parentId: 1 }),
      makeRequirement({ id: 3, name: "Uncovered Child", parentId: 1 }),
      makeRequirement({ id: 4, name: "Root B Covered", parentId: null }),
    ];
    useFindManyIssueMock.mockReturnValue({
      data: fixture,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    useRequirementCoverageMock.mockReturnValue({
      data: makeCoverageResponse({
        1: { linkedCaseCount: 3, passed: 3, status: "PASSED" },
        2: { linkedCaseCount: 3, passed: 3, status: "PASSED" },
        3: { uncovered: true, status: "UNCOVERED" },
        4: { linkedCaseCount: 1, passed: 1, status: "PASSED" },
      }),
      isError: false,
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("requirements-uncovered-toggle"));

    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    const treeData = lastCall[0].data as any[];

    // Ancestor kept for context, even though it is not itself uncovered.
    expect(findNodeById(treeData, "1")).not.toBeNull();
    // The uncovered leaf stays visible.
    expect(findNodeById(treeData, "3")).not.toBeNull();
    // A covered sibling under the SAME kept ancestor disappears -- proves
    // the toggle actually filters rather than just keeping everything
    // once any gap exists anywhere.
    expect(findNodeById(treeData, "2")).toBeNull();
    // A fully covered, unrelated root disappears entirely.
    expect(findNodeById(treeData, "4")).toBeNull();
  });

  it("intersects the uncovered toggle with the text filter rather than unioning them", () => {
    const fixture = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
      // Uncovered AND matches "login" -- must remain under both semantics.
      makeRequirement({ id: 2, name: "Login uncovered feature", parentId: 1 }),
      // Covered but matches "login" -- a union would keep this; the
      // intersection must not.
      makeRequirement({ id: 3, name: "Login covered feature", parentId: 1 }),
      // Uncovered but does NOT match "login" -- a union would keep this
      // too (uncovered alone qualifies); the intersection must not.
      makeRequirement({ id: 4, name: "Payments gap", parentId: 1 }),
    ];
    useFindManyIssueMock.mockReturnValue({
      data: fixture,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    useRequirementCoverageMock.mockReturnValue({
      data: makeCoverageResponse({
        1: { linkedCaseCount: 3, passed: 3, status: "PASSED" },
        2: { uncovered: true, status: "UNCOVERED" },
        3: { linkedCaseCount: 2, passed: 2, status: "PASSED" },
        4: { uncovered: true, status: "UNCOVERED" },
      }),
      isError: false,
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId("requirements-filter-input"), {
      target: { value: "login" },
    });
    fireEvent.click(screen.getByTestId("requirements-uncovered-toggle"));

    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    const treeData = lastCall[0].data as any[];

    expect(findNodeById(treeData, "1")).not.toBeNull(); // ancestor context
    expect(findNodeById(treeData, "2")).not.toBeNull(); // uncovered AND matches
    expect(findNodeById(treeData, "3")).toBeNull(); // covered, matches -> hidden
    expect(findNodeById(treeData, "4")).toBeNull(); // uncovered, no match -> hidden
  });

  it("disables the uncovered toggle when coverage is unavailable", () => {
    useFindManyIssueMock.mockReturnValue({
      data: deepChainAndSecondRoot,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    useRequirementCoverageMock.mockReturnValue({
      data: undefined,
      isError: true,
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const toggle = screen.getByTestId("requirements-uncovered-toggle");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute(
      "title",
      "requirements.coverage.showOnlyUncoveredUnavailable"
    );

    // A disabled control cannot hide anything: every node from the fixture
    // stays reachable.
    const lastCall = vi.mocked(Tree).mock.calls.at(-1)!;
    const treeData = lastCall[0].data as any[];
    ["1", "2", "3", "4", "5", "10"].forEach((id) => {
      expect(findNodeById(treeData, id)).not.toBeNull();
    });
  });

  it("keeps the requirement title yielding last: provenance shrinks hardest, then coverage, then the name", () => {
    const lockedWithCoverage = [
      makeRequirement({
        id: 1,
        name: "Root A",
        parentId: null,
        integrationId: 9,
        requirementDetachedAt: null,
      }),
    ];
    useFindManyIssueMock.mockReturnValue({
      data: lockedWithCoverage,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    useRequirementCoverageMock.mockReturnValue({
      data: makeCoverageResponse({
        1: {
          linkedCaseCount: 7,
          passed: 3,
          failed: 1,
          notRun: 3,
          status: "FAILED",
        },
      }),
      isError: false,
    });

    render(
      <RequirementsTreeView
        projectId="42"
        selectedRequirementId={null}
        onSelectRequirement={vi.fn()}
      />
    );

    const row = screen.getByTestId("requirement-node-1");
    // Anchored on the unique `flex-auto` token, never a fixed-width
    // character window -- four window-anchored verification scripts have
    // already mis-reported this milestone (see STATE.md).
    const nameSpan = row.querySelector('[class*="flex-auto"]') as HTMLElement;
    expect(nameSpan).toBeTruthy();
    expect(nameSpan.className).toContain("min-w-0");
    expect(nameSpan.className).toContain("flex-auto");
    expect(nameSpan.className).toContain("truncate");
    expect(nameSpan.className).not.toMatch(/shrink-\[/);

    const coverageBadge = screen.getByTestId("requirement-coverage-failed");
    // 26-13 moved the coverage badge's shrink class off the testid'd Badge
    // and onto its own wrapper span (it now needs an in-flow measuring
    // copy alongside the visible badge, mirroring the provenance badge's
    // own wrapper/badge split below) -- walk up from the testid'd element
    // rather than assuming the class sits on it directly.
    let coverageAncestor: HTMLElement | null = coverageBadge;
    let coverageShrink: number | null = null;
    while (coverageAncestor && coverageShrink === null) {
      const match = coverageAncestor.className.match(/shrink-\[(\d+)\]/);
      if (match) coverageShrink = Number(match[1]);
      coverageAncestor = coverageAncestor.parentElement;
    }
    expect(coverageShrink).not.toBeNull();

    const provenanceBadge = screen.getByTestId("requirement-provenance-locked");
    let ancestor: HTMLElement | null = provenanceBadge;
    let provenanceShrink: number | null = null;
    while (ancestor && provenanceShrink === null) {
      const match = ancestor.className.match(/shrink-\[(\d+)\]/);
      if (match) provenanceShrink = Number(match[1]);
      ancestor = ancestor.parentElement;
    }
    expect(provenanceShrink).not.toBeNull();

    // Floor-style ordering, not an exact-value pin on either sibling's own
    // weight (neither of which this file owns).
    expect(provenanceShrink!).toBeGreaterThan(coverageShrink!);
    expect(coverageShrink!).toBeGreaterThan(1);

    // Document order: name span, then the coverage indicator, then the
    // provenance badge.
    expect(
      nameSpan.compareDocumentPosition(coverageBadge) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      coverageBadge.compareDocumentPosition(provenanceBadge) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
