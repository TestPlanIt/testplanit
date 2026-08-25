// First co-located suite for this component. Todo-only scaffold, owner
// 27-10. Proves LINK-03's Pitfall 2 fix/fork (UI-SPEC.md): internal picks
// must add the issue id to the tracked array without an upsert call
// (27-RESEARCH.md's previously-undocumented gap — handleAddIssue silently
// drops internal picks today), while external picks keep upserting a
// shell exactly as before.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseFindManyIssue,
  mockUseUpsertIssue,
  mockUpsertAsync,
  mockRefetch,
  mockUseFindManyProjectIntegration,
} = vi.hoisted(() => ({
  mockUseFindManyIssue: vi.fn(),
  mockUseUpsertIssue: vi.fn(),
  mockUpsertAsync: vi.fn(),
  mockRefetch: vi.fn(),
  mockUseFindManyProjectIntegration: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useUpsert: mockUseUpsertIssue,
      useFindMany: mockUseFindManyIssue,
    },
    projectIntegration: { useFindMany: mockUseFindManyProjectIntegration },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "test-user-1" } } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let capturedOnIssueSelected: ((issue: any) => void) | null = null;
vi.mock("./search-issues-dialog", () => ({
  SearchIssuesDialog: ({ onIssueSelected }: any) => {
    capturedOnIssueSelected = onIssueSelected;
    return null;
  },
}));

import { toast } from "sonner";
import { DeferredIssueManager } from "./DeferredIssueManager";

const internalPick = {
  isExternal: false,
  id: 88,
  name: "TPI-9",
  title: "Fix flaky login test",
};

const externalPick = {
  isExternal: true,
  id: "10001",
  key: "TPI-77",
  title: "Login flakiness",
  status: "Open",
};

function renderManager(
  props: Partial<Parameters<typeof DeferredIssueManager>[0]> = {}
) {
  const onIssuesChange = vi.fn();
  render(
    <DeferredIssueManager
      projectId={7}
      selectedIssues={[]}
      linkedIssueIds={[]}
      onIssuesChange={onIssuesChange}
      {...props}
    />
  );
  return { onIssuesChange };
}

describe("DeferredIssueManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnIssueSelected = null;
    mockUseFindManyIssue.mockReturnValue({ data: [], refetch: mockRefetch });
    mockUseUpsertIssue.mockReturnValue({ mutateAsync: mockUpsertAsync });
    mockUpsertAsync.mockResolvedValue({ id: 99, key: "TPI-77" });
    mockUseFindManyProjectIntegration.mockReturnValue({
      data: [{ integrationId: 1, integration: { id: 1, provider: "jira" } }],
    });
  });

  describe("internal issue picks", () => {
    it("adds an internally picked issue id to the tracked array", async () => {
      const { onIssuesChange } = renderManager({ linkedIssueIds: [1, 2] });

      expect(capturedOnIssueSelected).not.toBeNull();
      await capturedOnIssueSelected!(internalPick);

      expect(onIssuesChange).toHaveBeenCalledWith([1, 2, 88]);
      expect(toast.success).toHaveBeenCalled();
    });

    it("does not call the issue upsert for an internally picked issue", async () => {
      renderManager({ linkedIssueIds: [] });

      await capturedOnIssueSelected!(internalPick);

      expect(mockUpsertAsync).not.toHaveBeenCalled();
    });

    it("still upserts a shell for an externally picked issue", async () => {
      const { onIssuesChange } = renderManager({ linkedIssueIds: [] });

      await capturedOnIssueSelected!(externalPick);

      expect(mockUpsertAsync).toHaveBeenCalledTimes(1);
      expect(onIssuesChange).toHaveBeenCalledWith([99]);
      expect(toast.success).toHaveBeenCalled();
    });

    it("does not duplicate an internally picked issue already in linkedIssueIds", async () => {
      const { onIssuesChange } = renderManager({ linkedIssueIds: [88] });

      await capturedOnIssueSelected!(internalPick);

      expect(onIssuesChange).not.toHaveBeenCalled();
      expect(mockUpsertAsync).not.toHaveBeenCalled();
    });
  });

  it("renders the label when provided", () => {
    renderManager({ label: "References" });
    expect(screen.getByText("References")).toBeInTheDocument();
  });
});
