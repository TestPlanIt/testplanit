import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "~/test/test-utils";
import { SearchableEntityType } from "~/types/search";

import { SaveSearchDialog } from "./SaveSearchDialog";

const mocks = vi.hoisted(() => ({
  createShareLink: vi.fn(),
  prepareShareLinkData: vi.fn(),
  auditShareLinkCreation: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    shareLink: {
      useCreate: () => ({
        mutateAsync: mocks.createShareLink,
        isPending: false,
      }),
    },
  }),
}));

vi.mock("@/actions/share-links", () => ({
  prepareShareLinkData: mocks.prepareShareLinkData,
  auditShareLinkCreation: mocks.auditShareLinkCreation,
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

// The global next-intl mock (vitest.setup.tsx) uses a hand-pasted message
// subset that predates these keys; resolve against the real en-US catalog so
// labels and validation copy render as shipped.
vi.mock("next-intl", async () => {
  const messages = (await import("../../messages/en-US.json")).default;
  const get = (k: string) =>
    k
      .split(".")
      .reduce<any>((acc, part) => (acc ? acc[part] : undefined), messages);
  return {
    useTranslations: () => (key: string, params?: Record<string, unknown>) => {
      let msg = get(key);
      if (typeof msg !== "string") return key;
      if (params) {
        for (const [p, v] of Object.entries(params)) {
          msg = msg.split(`{${p}}`).join(String(v));
        }
      }
      return msg;
    },
  };
});

const criteria = {
  query: "flaky login",
  selectedEntities: [SearchableEntityType.REPOSITORY_CASE],
  currentProjectOnly: true,
  filters: { repositoryCase: { tagIds: [5] } },
};

describe("SaveSearchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareShareLinkData.mockResolvedValue({
      shareKey: "key-123",
      passwordHash: null,
    });
    mocks.createShareLink.mockResolvedValue({
      id: "sl-1",
      shareKey: "key-123",
      entityType: "SEARCH",
      mode: "AUTHENTICATED",
      title: "My saved search",
      projectId: null,
      expiresAt: null,
      notifyOnView: false,
      passwordHash: null,
    });
    mocks.auditShareLinkCreation.mockResolvedValue(undefined);
  });

  it("saves an AUTHENTICATED SEARCH share with versioned criteria as entityConfig", async () => {
    const onOpenChange = vi.fn();
    render(
      <SaveSearchDialog open onOpenChange={onOpenChange} criteria={criteria} />
    );

    fireEvent.change(screen.getByTestId("saved-search-name-input"), {
      target: { value: "My saved search" },
    });
    fireEvent.click(screen.getByTestId("saved-search-save-button"));

    await waitFor(() => {
      expect(mocks.createShareLink).toHaveBeenCalledTimes(1);
    });

    expect(mocks.prepareShareLinkData).toHaveBeenCalledWith({ password: null });

    const { data } = mocks.createShareLink.mock.calls[0][0];
    expect(data.entityType).toBe("SEARCH");
    expect(data.mode).toBe("AUTHENTICATED");
    expect(data.passwordHash).toBeNull();
    expect(data.expiresAt).toBeNull();
    expect(data.title).toBe("My saved search");
    expect(data.createdById).toBe("user-1");
    expect(data.entityConfig).toMatchObject({
      version: 1,
      query: "flaky login",
      currentProjectOnly: true,
      selectedEntities: [SearchableEntityType.REPOSITORY_CASE],
    });

    expect(mocks.auditShareLinkCreation).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("pre-fills the name from the current query", () => {
    render(
      <SaveSearchDialog open onOpenChange={vi.fn()} criteria={criteria} />
    );
    expect(screen.getByTestId("saved-search-name-input")).toHaveValue(
      "flaky login"
    );
  });

  it("requires a name and does not create when blank", async () => {
    render(
      <SaveSearchDialog open onOpenChange={vi.fn()} criteria={criteria} />
    );

    fireEvent.change(screen.getByTestId("saved-search-name-input"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("saved-search-save-button"));

    await waitFor(() => {
      expect(
        screen.getByText("Enter a name for this search.")
      ).toBeInTheDocument();
    });
    expect(mocks.createShareLink).not.toHaveBeenCalled();
  });
});
