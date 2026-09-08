import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseFindMany,
  mockCreate,
  mockUpdate,
  mockRefetch,
  mockPrepareShareLinkData,
  mockAuditShareLinkCreation,
  mockSession,
} = vi.hoisted(() => ({
  mockUseFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockRefetch: vi.fn(),
  mockPrepareShareLinkData: vi.fn(),
  mockAuditShareLinkCreation: vi.fn(),
  mockSession: { user: { id: "user-1" } } as { user: { id: string } } | null,
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    shareLink: {
      useFindMany: mockUseFindMany,
      useCreate: () => ({ mutateAsync: mockCreate, isPending: false }),
      useUpdate: () => ({ mutateAsync: mockUpdate, isPending: false }),
    },
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: sessionValue }),
}));

vi.mock("@/actions/share-links", () => ({
  prepareShareLinkData: mockPrepareShareLinkData,
  auditShareLinkCreation: mockAuditShareLinkCreation,
}));

import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  buildSavedRepositoryViewConfig,
  SAVED_REPOSITORY_VIEW_CONFIG_VERSION,
} from "~/lib/schemas/savedRepositoryView";

import {
  SAVED_REPOSITORY_VIEWS_FETCH_LIMIT,
  useSavedRepositoryViews,
} from "./useSavedRepositoryViews";

let sessionValue: typeof mockSession = mockSession;

const PROJECT_ID = 7;
const registry = buildFilterDimensions({
  dynamicFields: [{ fieldId: 42, type: "Dropdown" }],
});

function renderSavedViews(
  overrides: Partial<Parameters<typeof useSavedRepositoryViews>[0]> = {}
) {
  return renderHook(() =>
    useSavedRepositoryViews({ projectId: PROJECT_ID, registry, ...overrides })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionValue = { user: { id: "user-1" } };
  mockUseFindMany.mockReturnValue({
    data: [],
    isLoading: false,
    refetch: mockRefetch,
  });
  mockRefetch.mockResolvedValue({ data: [] });
  mockCreate.mockResolvedValue({
    id: "link-1",
    shareKey: "key-1",
    entityType: "REPOSITORY_VIEW",
    mode: "AUTHENTICATED",
    title: "My view",
    expiresAt: null,
    notifyOnView: false,
  });
  mockUpdate.mockResolvedValue({ id: "link-1" });
  mockPrepareShareLinkData.mockResolvedValue({
    shareKey: "key-1",
    passwordHash: null,
  });
  mockAuditShareLinkCreation.mockResolvedValue(undefined);
});

describe("useSavedRepositoryViews", () => {
  it("lists only the signed-in user's private REPOSITORY_VIEW links", () => {
    renderSavedViews();

    const [args, options] = mockUseFindMany.mock.calls[0];
    expect(args).toMatchObject({
      where: {
        entityType: "REPOSITORY_VIEW",
        createdById: "user-1",
        // Privacy is DB-enforced by the ShareLink policy for null-project
        // links; the owning project lives inside entityConfig.
        projectId: null,
        isDeleted: false,
        isRevoked: false,
      },
      orderBy: { updatedAt: "desc" },
      take: SAVED_REPOSITORY_VIEWS_FETCH_LIMIT,
    });
    expect(options).toMatchObject({ enabled: true });
  });

  it("keeps the query disabled without a session or when not enabled", () => {
    sessionValue = null;
    renderSavedViews();
    expect(mockUseFindMany.mock.calls[0][1]).toMatchObject({ enabled: false });

    sessionValue = { user: { id: "user-1" } };
    renderSavedViews({ enabled: false });
    expect(mockUseFindMany.mock.calls[1][1]).toMatchObject({ enabled: false });
  });

  it("parses stored configs, filters other projects and counts unreadable rows", () => {
    mockUseFindMany.mockReturnValue({
      data: [
        {
          id: "a",
          title: "Automated cases",
          description: null,
          updatedAt: "2026-08-01T10:00:00.000Z",
          entityConfig: buildSavedRepositoryViewConfig({
            projectId: PROJECT_ID,
            predicates: [
              { dimension: "templates", operator: "in", values: [1] },
              // Deleted custom field: dropped, the view still loads.
              { dimension: "field_99", operator: "in", values: [3] },
            ],
            axis: "folders",
            search: "login",
          }),
        },
        {
          id: "b",
          title: "Another project",
          description: null,
          updatedAt: null,
          entityConfig: buildSavedRepositoryViewConfig({
            projectId: PROJECT_ID + 1,
            predicates: [],
            axis: null,
            search: "",
          }),
        },
        {
          id: "c",
          title: "Saved by a newer release",
          description: null,
          updatedAt: null,
          entityConfig: {
            version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION + 1,
            projectId: PROJECT_ID,
            predicates: [],
          },
        },
      ],
      isLoading: false,
      refetch: mockRefetch,
    });

    const { result } = renderSavedViews();

    expect(result.current.views).toHaveLength(1);
    const [view] = result.current.views;
    expect(view.id).toBe("a");
    expect(view.title).toBe("Automated cases");
    expect(view.updatedAt).toBeInstanceOf(Date);
    expect(view.criteria).toEqual({
      projectId: PROJECT_ID,
      predicates: [{ dimension: "templates", operator: "in", values: [1] }],
      axis: "folders",
      search: "login",
    });
    expect(view.droppedPredicateCount).toBe(1);
    // Only the newer-version row is unreadable; the other project's is not.
    expect(result.current.unreadableCount).toBe(1);
  });

  it("creates a private, project-less ShareLink and audits it", async () => {
    const { result } = renderSavedViews();

    let created = "";
    await act(async () => {
      created = await result.current.saveView({
        name: "  Flaky sweep  ",
        description: "  cases to triage  ",
        criteria: {
          predicates: [{ dimension: "tags", operator: "any", values: [] }],
          axis: "tags",
          search: "flaky",
        },
      });
    });

    expect(created).toBe("link-1");
    const [{ data }] = mockCreate.mock.calls[0];
    expect(data).toMatchObject({
      shareKey: "key-1",
      entityType: "REPOSITORY_VIEW",
      createdById: "user-1",
      mode: "AUTHENTICATED",
      passwordHash: null,
      expiresAt: null,
      notifyOnView: false,
      title: "Flaky sweep",
      description: "cases to triage",
    });
    // projectId is never set on the row itself — see the hook's PRIVACY note.
    expect("projectId" in data).toBe(false);
    expect(data.entityConfig).toEqual({
      version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION,
      projectId: PROJECT_ID,
      predicates: [{ dimension: "tags", operator: "any", values: [] }],
      axis: "tags",
      search: "flaky",
    });
    expect(mockAuditShareLinkCreation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "link-1", projectId: PROJECT_ID })
    );
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("still reports a successful save when the audit write fails", async () => {
    mockAuditShareLinkCreation.mockRejectedValue(new Error("audit down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderSavedViews();

    await act(async () => {
      await expect(
        result.current.saveView({
          name: "View",
          criteria: { predicates: [], axis: "folders", search: "" },
        })
      ).resolves.toBe("link-1");
    });

    consoleSpy.mockRestore();
  });

  it("refuses to save without a name or a session", async () => {
    const { result } = renderSavedViews();
    await act(async () => {
      await expect(
        result.current.saveView({
          name: "   ",
          criteria: { predicates: [], axis: null, search: "" },
        })
      ).rejects.toThrow(/name is required/);
    });
    expect(mockCreate).not.toHaveBeenCalled();

    sessionValue = null;
    const { result: anonymous } = renderSavedViews();
    await act(async () => {
      await expect(
        anonymous.current.saveView({
          name: "View",
          criteria: { predicates: [], axis: null, search: "" },
        })
      ).rejects.toThrow(/signed-in user/);
    });
    expect(mockPrepareShareLinkData).not.toHaveBeenCalled();
  });

  it("renames a view through the shareLink update hook", async () => {
    const { result } = renderSavedViews();

    await act(async () => {
      await result.current.renameView({
        id: "link-1",
        name: "  Renamed  ",
        description: "   ",
      });
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: { title: "Renamed", description: null },
    });
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("soft-deletes a view", async () => {
    const { result } = renderSavedViews();

    await act(async () => {
      await result.current.deleteView("link-1");
    });

    const [args] = mockUpdate.mock.calls[0];
    expect(args.where).toEqual({ id: "link-1" });
    expect(args.data.isDeleted).toBe(true);
    expect(args.data.deletedAt).toBeInstanceOf(Date);
    expect(mockRefetch).toHaveBeenCalled();
  });
});
