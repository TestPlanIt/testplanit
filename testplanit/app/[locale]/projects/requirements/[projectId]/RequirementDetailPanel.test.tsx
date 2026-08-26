import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// LinkedRequirementCasesPanel's useRequirementCaseLinks hook calls
// useQueryClient() unconditionally on every render (not just on
// link/unlink), so this file needs a QueryClient stand-in even though none
// of its own tests exercise the link/unlink flow directly (that is
// LinkedRequirementCasesPanel.test.tsx's job).
const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("~/utils/storageUrl", () => ({
  getStorageUrlClient: (url: string) => `https://storage.example.com/${url}`,
}));

const { mockFetchSignedUrl } = vi.hoisted(() => ({
  mockFetchSignedUrl: vi.fn(),
}));
vi.mock("~/utils/fetchSignedUrl", () => ({
  fetchSignedUrl: mockFetchSignedUrl,
}));

// Same simplified always-rendered-content convention AttachmentsDisplay.test.tsx
// already established for this exact primitive -- avoids depending on
// Radix's real open/portal behavior for a plain click-to-confirm affordance.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children }: any) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: any) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("@/components/AttachmentPreview", () => ({
  AttachmentPreview: ({ attachment }: any) => (
    <div data-testid={`attachment-preview-${attachment.id}`} />
  ),
}));

// Stand-in for the file picker: a button that hands a fixed File to
// onFileSelect, mirroring the tiptap-note-simulate-edit convention below.
vi.mock("@/components/UploadAttachments", () => ({
  default: ({ onFileSelect, disabled }: any) => (
    <div data-testid="requirement-attachments-upload">
      <button
        type="button"
        data-testid="requirement-attachments-upload-simulate-select"
        disabled={disabled}
        onClick={() =>
          onFileSelect([
            new File(["contents"], "spec.pdf", { type: "application/pdf" }),
          ])
        }
      >
        simulate select
      </button>
    </div>
  ),
}));

// Same testid + data-readonly convention MilestoneFormControls.test.tsx
// already established for this exact component. `data-content` is this
// file's own addition, needed to assert the parsed doc TipTapEditor was
// actually handed. The simulate-edit button stands in for a real editor
// keystroke -- the mock has no rich-text surface of its own to type into.
vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: ({ readOnly, content, onUpdate }: any) => (
    <div
      data-testid="tiptap-note"
      data-readonly={String(!!readOnly)}
      data-content={JSON.stringify(content)}
    >
      <button
        type="button"
        data-testid="tiptap-note-simulate-edit"
        onClick={() =>
          onUpdate?.({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Edited" }],
              },
            ],
          })
        }
      >
        simulate edit
      </button>
    </div>
  ),
}));

// The badge's own behavior (three states, detach action, admin gating) is
// RequirementProvenanceBadge.test.tsx's job (25-07) -- this file only needs
// to prove the panel renders it for the selected requirement.
vi.mock("./RequirementProvenanceBadge", () => ({
  RequirementProvenanceBadge: ({ requirement }: any) => (
    <div
      data-testid="requirement-provenance-badge"
      data-requirement-id={requirement.id}
    />
  ),
}));

// The coverage panel's own behavior (rows, inherited marking, cross-project
// links) is RequirementCoveragePanel.test.tsx's job (26-09) -- this file
// only needs to prove it mounts, and where.
vi.mock("./RequirementCoveragePanel", () => ({
  RequirementCoveragePanel: ({ requirementId }: any) => (
    <div
      data-testid="requirement-coverage-panel"
      data-requirement-id={requirementId}
    />
  ),
}));

const {
  mockUseFindFirst,
  mockUpdateMutateAsync,
  mockAttachmentsFindMany,
  mockCreateAttachmentMutateAsync,
  mockUpdateAttachmentMutateAsync,
  mockRepositoryCasesFindMany,
  mockRepositoryCaseIssueFindMany,
  mockRequirementIssueReferenceFindMany,
} = vi.hoisted(() => ({
  mockUseFindFirst: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockAttachmentsFindMany: vi.fn(),
  mockCreateAttachmentMutateAsync: vi.fn(),
  mockUpdateAttachmentMutateAsync: vi.fn(),
  mockRepositoryCasesFindMany: vi.fn(),
  mockRepositoryCaseIssueFindMany: vi.fn(),
  mockRequirementIssueReferenceFindMany: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useFindFirst: mockUseFindFirst,
      useUpdate: () => ({ mutateAsync: mockUpdateMutateAsync }),
      // COV-05's requirement-side content timestamp, read by
      // LinkedRequirementCasesPanel (27-11) -- not exercised by this file's
      // own assertions, only needed so the panel renders without crashing.
      useFindUnique: () => ({ data: undefined }),
    },
    attachments: {
      useFindMany: mockAttachmentsFindMany,
      useCreate: () => ({ mutateAsync: mockCreateAttachmentMutateAsync }),
      useUpdate: () => ({ mutateAsync: mockUpdateAttachmentMutateAsync }),
    },
    // LinkedRequirementCasesPanel's own read -- its full behavior is
    // covered by LinkedRequirementCasesPanel.test.tsx; this file only needs
    // it to render without crashing (empty list, matching every fixture
    // below).
    repositoryCases: {
      useFindMany: mockRepositoryCasesFindMany,
    },
    // COV-05's requirement-side suspect-flag inputs, mounted inside
    // LinkedRequirementCasesPanel (27-11) -- again only needed here to
    // render without crashing; the flag's own behavior is
    // LinkedRequirementCasesPanel.test.tsx's job.
    repositoryCaseIssue: {
      useFindMany: mockRepositoryCaseIssueFindMany,
      useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
    },
    // RequirementReferencesPanel's own read -- its full behavior is covered
    // by RequirementReferencesPanel.test.tsx; this file only needs it to
    // render without crashing (empty list, matching every fixture below).
    requirementIssueReference: {
      useFindMany: mockRequirementIssueReferenceFindMany,
    },
  }),
}));

import RequirementDetailPanel from "./RequirementDetailPanel";

const sampleDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

const nativeRequirement = {
  id: 1,
  name: "Req Native",
  title: "Req Native Title",
  status: "open",
  priority: "medium",
  note: null,
  isRequirement: true,
  integrationId: null,
  requirementDetachedAt: null,
  externalKey: null,
  externalUrl: null,
  issueTypeIconUrl: null,
};

const lockedRequirement = {
  ...nativeRequirement,
  id: 2,
  name: "Req Synced",
  title: "Req Synced Title",
  note: sampleDoc,
  integrationId: 9,
  externalKey: "REQ-100",
  externalUrl: "https://jira.example.com/browse/REQ-100",
};

const detachedRequirement = {
  ...lockedRequirement,
  id: 3,
  requirementDetachedAt: new Date().toISOString(),
};

function setRequirement(row: any) {
  mockUseFindFirst.mockReturnValue({ data: row, isLoading: false });
}

// COV-05 (27-11) gave LinkedRequirementCasesPanel -- mounted for real in
// every test below -- its own real useRequirementCoveringCases() call
// (useQueryClient is mocked above, but that only intercepts the PUBLIC
// export; useQuery's own module-internal reference to it still needs a
// real QueryClientProvider ancestor). retry: false keeps a stubbed-away
// fetch failure from retrying and slowing teardown.
function renderPanel(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

function getFieldDisabledMap(): Record<string, boolean> {
  return {
    title: (screen.getByTestId("requirement-field-title") as HTMLInputElement)
      .disabled,
    status: (screen.getByTestId("requirement-field-status") as HTMLInputElement)
      .disabled,
    priority: (
      screen.getByTestId("requirement-field-priority") as HTMLInputElement
    ).disabled,
  };
}

describe("RequirementDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMutateAsync.mockResolvedValue({});
    mockAttachmentsFindMany.mockReturnValue({ data: [], isLoading: false });
    mockCreateAttachmentMutateAsync.mockResolvedValue({ id: 501 });
    mockUpdateAttachmentMutateAsync.mockResolvedValue({});
    mockFetchSignedUrl.mockResolvedValue(
      "https://storage.example.com/spec.pdf"
    );
    mockRepositoryCasesFindMany.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    });
    mockRepositoryCaseIssueFindMany.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    });
    mockRequirementIssueReferenceFindMany.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    });
    // LinkedRequirementCasesPanel's useRequirementCoveringCases (27-11) now
    // fires a real fetch to the covering-cases route on every render --
    // answered here so it resolves cleanly instead of rejecting; every
    // other path this file exercises still goes through a mocked ZenStack
    // hook or mocked mutateAsync, never this fetch.
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/covering-cases")) {
        return {
          ok: true,
          json: async () => ({ requirementId: 0, cases: [] }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;
  });

  it("renders the provenance badge for the selected requirement", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);

    const badge = screen.getByTestId("requirement-provenance-badge");
    expect(badge).toHaveAttribute("data-requirement-id", "1");
  });

  it("renders the Tiptap editor bound to Issue.note", () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);

    const editor = screen.getByTestId("tiptap-note");
    expect(editor).toBeInTheDocument();
    expect(JSON.parse(editor.getAttribute("data-content")!)).toEqual(sampleDoc);
  });

  it("parses a legacy string note and a structured JSON note identically", () => {
    const legacyRow = {
      ...lockedRequirement,
      id: 4,
      note: JSON.stringify(sampleDoc),
    };
    setRequirement(legacyRow);
    const { unmount } = renderPanel(
      <RequirementDetailPanel projectId="7" requirementId={4} />
    );
    const legacyContent = screen
      .getByTestId("tiptap-note")
      .getAttribute("data-content");
    unmount();

    const structuredRow = { ...lockedRequirement, id: 5, note: sampleDoc };
    setRequirement(structuredRow);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={5} />);
    const structuredContent = screen
      .getByTestId("tiptap-note")
      .getAttribute("data-content");

    expect(JSON.parse(legacyContent!)).toEqual(JSON.parse(structuredContent!));
  });

  it("keeps the note editable on a synced, non-detached requirement", () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);

    expect(screen.getByTestId("tiptap-note")).toHaveAttribute(
      "data-readonly",
      "true"
    );

    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    expect(screen.getByTestId("tiptap-note")).toHaveAttribute(
      "data-readonly",
      "false"
    );
    // The scalar fields stay disabled (locked); the note does not -- proves
    // the lock and the note's editability are governed independently.
    expect(getFieldDisabledMap().title).toBe(true);
  });

  it("disables the locked fields on a synced, non-detached requirement", () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const disabledMap = getFieldDisabledMap();
    expect(Object.values(disabledMap).every((v) => v === true)).toBe(true);
  });

  it("enables the same fields on a detached requirement", () => {
    setRequirement(detachedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={3} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const disabledMap = getFieldDisabledMap();
    expect(Object.values(disabledMap).every((v) => v === false)).toBe(true);
  });

  it("enables the same fields on a native requirement, identically to a detached one", () => {
    setRequirement(detachedRequirement);
    const { unmount } = renderPanel(
      <RequirementDetailPanel projectId="7" requirementId={3} />
    );
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));
    const detachedMap = getFieldDisabledMap();
    unmount();

    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));
    const nativeMap = getFieldDisabledMap();

    // Map equality, not a per-row assertion -- this is what makes PROV-03's
    // "one state, not two code paths" claim testable rather than merely
    // inspectable: two fixtures reaching the same values through different
    // logic would still fail this comparison if the maps diverged in shape.
    expect(nativeMap).toEqual(detachedMap);
    expect(Object.values(nativeMap).every((v) => v === false)).toBe(true);
  });

  it("saves the note through the ZenStack issue update hook, not a bespoke route", async () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const saveButton = screen.getByTestId(
      "requirement-detail-save"
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true); // no dirty state yet

    fireEvent.click(screen.getByTestId("tiptap-note-simulate-edit"));
    expect(saveButton.disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          note: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Edited" }],
              },
            ],
          },
        },
      });
    });
    // The note save itself must never reach a REST route -- narrowed to
    // "no /api/issues call" (27-11: the sibling LinkedRequirementCasesPanel
    // now legitimately fetches its own covering-cases route on every
    // render, so a blanket "fetch was never called" assertion no longer
    // isolates the note-save path specifically).
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/issues"),
      expect.anything()
    );
  });

  // UAT Scenario 2 regression (2026-08-25): a priority-only save on a
  // null-note requirement must NOT include `note` in the payload. The form
  // loads a null note as the canonical empty doc, so unconditionally
  // sending it rewrote NULL -> empty-doc -- and `note` is a watched column
  // of the contentUpdatedAt trigger, so the phantom write armed the suspect
  // flag on a save that never touched content (COV-05 D-02).
  it("omits an unchanged note from a priority-only save payload", async () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    fireEvent.change(screen.getByTestId("requirement-field-priority"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByTestId("requirement-detail-save"));

    await waitFor(() => {
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          title: "Req Native Title",
          status: "open",
          priority: "high",
        },
      });
    });
    const payload = mockUpdateMutateAsync.mock.calls[0][0].data;
    expect("note" in payload).toBe(false);
  });

  it("uploads an attachment through the signed-url path and creates an Attachments row with issueId", async () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);

    fireEvent.click(
      screen.getByTestId("requirement-attachments-upload-simulate-select")
    );

    await waitFor(() => {
      expect(mockFetchSignedUrl).toHaveBeenCalledWith(
        expect.any(File),
        "/api/get-attachment-url/",
        expect.stringContaining("7")
      );
    });

    await waitFor(() => {
      expect(mockCreateAttachmentMutateAsync).toHaveBeenCalledWith({
        data: expect.objectContaining({
          issue: { connect: { id: 2 } },
          url: "https://storage.example.com/spec.pdf",
          name: "spec.pdf",
          mimeType: "application/pdf",
          size: expect.any(BigInt),
          createdBy: { connect: { id: "user-1" } },
        }),
      });
    });
    const payload = mockCreateAttachmentMutateAsync.mock.calls[0][0].data;
    expect(typeof payload.size).toBe("bigint");

    // The zero-consumer legacy upload route must never be reached -- the
    // signed-url path above is the entire upload mechanism.
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/upload-attachment"),
      expect.anything()
    );
  });

  it("lists the requirement's existing attachments and offers a soft-delete removal", async () => {
    setRequirement(lockedRequirement);
    mockAttachmentsFindMany.mockReturnValue({
      data: [
        {
          id: 501,
          issueId: 2,
          name: "existing-spec.pdf",
          url: "requirements/existing-spec.pdf",
          mimeType: "application/pdf",
          size: 2048,
          isDeleted: false,
          createdAt: new Date().toISOString(),
          createdById: "user-1",
        },
      ],
      isLoading: false,
    });

    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);

    expect(screen.getByText("existing-spec.pdf")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("requirement-attachment-remove-501"));
    fireEvent.click(
      screen.getByTestId("requirement-attachment-remove-confirm-501")
    );

    await waitFor(() => {
      expect(mockUpdateAttachmentMutateAsync).toHaveBeenCalledWith({
        where: { id: 501 },
        data: { isDeleted: true },
      });
    });
  });
});

describe("RequirementDetailPanel (Phase 26 coverage additions)", () => {
  it("mounts the coverage panel above the linked-cases panel", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);

    const coveragePanel = screen.getByTestId("requirement-coverage-panel");
    const linkedCasesPanel = screen.getByTestId("requirement-linked-cases");

    expect(coveragePanel).toHaveAttribute("data-requirement-id", "1");
    // Document ORDER, not merely presence -- "above" is the claim, and a
    // test that only asserts both exist would pass with them swapped.
    expect(
      coveragePanel.compareDocumentPosition(linkedCasesPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // The linked-cases panel's own behavior is untouched by this mount --
    // it still renders its add-link affordance (its full add/unlink
    // behavior is LinkedRequirementCasesPanel.test.tsx's job).
    expect(
      screen.getByTestId("requirement-linked-cases-add")
    ).toBeInTheDocument();
  });
});
