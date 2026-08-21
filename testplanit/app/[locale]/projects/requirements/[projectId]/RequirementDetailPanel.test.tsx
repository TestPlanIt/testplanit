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

const { mockUseFindFirst, mockUpdateMutateAsync } = vi.hoisted(() => ({
  mockUseFindFirst: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useFindFirst: mockUseFindFirst,
      useUpdate: () => ({ mutateAsync: mockUpdateMutateAsync }),
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
    global.fetch = vi.fn();
  });

  it("renders the provenance badge for the selected requirement", () => {
    setRequirement(nativeRequirement);
    render(<RequirementDetailPanel projectId="7" requirementId={1} />);

    const badge = screen.getByTestId("requirement-provenance-badge");
    expect(badge).toHaveAttribute("data-requirement-id", "1");
  });

  it("renders the Tiptap editor bound to Issue.note", () => {
    setRequirement(lockedRequirement);
    render(<RequirementDetailPanel projectId="7" requirementId={2} />);

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
    const { unmount } = render(
      <RequirementDetailPanel projectId="7" requirementId={4} />
    );
    const legacyContent = screen
      .getByTestId("tiptap-note")
      .getAttribute("data-content");
    unmount();

    const structuredRow = { ...lockedRequirement, id: 5, note: sampleDoc };
    setRequirement(structuredRow);
    render(<RequirementDetailPanel projectId="7" requirementId={5} />);
    const structuredContent = screen
      .getByTestId("tiptap-note")
      .getAttribute("data-content");

    expect(JSON.parse(legacyContent!)).toEqual(JSON.parse(structuredContent!));
  });

  it("keeps the note editable on a synced, non-detached requirement", () => {
    setRequirement(lockedRequirement);
    render(<RequirementDetailPanel projectId="7" requirementId={2} />);

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
    render(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const disabledMap = getFieldDisabledMap();
    expect(Object.values(disabledMap).every((v) => v === true)).toBe(true);
  });

  it("enables the same fields on a detached requirement", () => {
    setRequirement(detachedRequirement);
    render(<RequirementDetailPanel projectId="7" requirementId={3} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const disabledMap = getFieldDisabledMap();
    expect(Object.values(disabledMap).every((v) => v === false)).toBe(true);
  });

  it("enables the same fields on a native requirement, identically to a detached one", () => {
    setRequirement(detachedRequirement);
    const { unmount } = render(
      <RequirementDetailPanel projectId="7" requirementId={3} />
    );
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));
    const detachedMap = getFieldDisabledMap();
    unmount();

    setRequirement(nativeRequirement);
    render(<RequirementDetailPanel projectId="7" requirementId={1} />);
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
    render(<RequirementDetailPanel projectId="7" requirementId={2} />);
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
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
