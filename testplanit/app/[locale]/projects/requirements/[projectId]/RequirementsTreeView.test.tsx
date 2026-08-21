import { fireEvent, render, screen } from "@testing-library/react";
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
    (
      _args?: { where?: Record<string, unknown>; orderBy?: unknown }
    ): {
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

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useFindMany: useFindManyIssueMock,
    },
  }),
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

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: null,
    isProjectAdmin: true,
    isLoading: false,
  }),
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
  makeRequirement({ id: 5, name: "Great-great-grandchild A1a-i-x", parentId: 4 }),
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

describe("RequirementsTreeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toggleSpies.clear();
    useFindManyIssueMock.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
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

  it.todo(
    "posts the dragged node and its new parent to the reparent route rather than writing parentId directly"
  );
  it.todo("dropping onto the bottom zone reparents the node to the root level");
  it.todo(
    "surfaces a server-rejected reparent as an error toast and leaves the tree unchanged"
  );
  it.todo("disables drag when the viewer cannot edit the project");
  it.todo("creates a native requirement with isRequirement true and the selected parentId");
  it.todo("renames a requirement in place through the ZenStack update hook");
  it.todo("does not offer rename on a synced, non-detached requirement");
});
