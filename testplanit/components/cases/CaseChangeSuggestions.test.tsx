import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  links: vi.fn(),
  refetchLinks: vi.fn(),
  refetch: vi.fn(),
  fetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join("|")})` : key,
}));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    caseChangeSuggestion: {
      useFindMany: (...a: unknown[]) => mocks.find(...a),
    },
    repositoryCaseIssue: {
      useFindMany: (...a: unknown[]) => mocks.links(...a),
    },
  }),
}));
vi.mock("~/app/[locale]/projects/repository/[projectId]/DeleteCase", () => ({
  DeleteCaseModal: ({
    testcase,
    onClose,
    onConfirm,
  }: {
    testcase: { name: string };
    onClose: () => void;
    onConfirm: () => Promise<void>;
  }) => (
    <div data-testid="delete-case-modal">
      {testcase.name}
      <button type="button" data-testid="delete-cancel" onClick={onClose} />
      <button
        type="button"
        data-testid="delete-confirm"
        onClick={() => void onConfirm().then(onClose)}
      />
    </div>
  ),
}));
vi.mock("~/lib/basePath", () => ({
  apiFetch: (...a: unknown[]) => mocks.fetch(...a),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mocks.toastSuccess(...a),
    error: (...a: unknown[]) => mocks.toastError(...a),
  },
}));
vi.mock("@/components/WordDiffText", () => ({
  WordDiffText: ({ before, after }: { before: string; after: string }) => (
    <div data-testid="diff">{`${before} => ${after}`}</div>
  ),
}));

import {
  CaseChangeSuggestions,
  fieldValueText,
  readProposal,
} from "./CaseChangeSuggestions";

const base = {
  name: "Totals add up",
  fieldValues: { Priority: "High", Tags: ["a", "b"], Notes: "Smoke" },
  steps: [
    { step: "Open the cart", expectedResult: "Total is shown" },
    { step: "Remove an item", expectedResult: "" },
  ],
};
const update = {
  id: 9,
  kind: "UPDATE",
  rationale: "Tax is now included",
  baseCaseVersion: 3,
  proposed: {
    templateId: 4,
    base,
    name: "Totals include tax",
    fieldValues: { Priority: "Low", Tags: ["a", "b"], Notes: "Smoke" },
    steps: [
      { step: "Open the cart", expectedResult: "Total with tax is shown" },
      { step: "Remove an item", expectedResult: "" },
      { step: "Check out", expectedResult: "" },
    ],
  },
  issue: {
    id: 100,
    name: "DEMO-42",
    title: "Checkout totals",
    externalUrl: "https://jira.example/browse/DEMO-42",
  },
};
const retire = {
  id: 10,
  kind: "RETIRE",
  rationale: null,
  baseCaseVersion: 3,
  proposed: null,
  issue: { id: 101, name: "Local 3", title: null, externalUrl: null },
};

const ok = (body: unknown) => ({ ok: true, json: async () => body });
const refused = (code: string, status = 409) => ({
  ok: false,
  status,
  json: async () => ({ code }),
});

/** Suggestions start collapsed; open each one. */
function expandAll() {
  for (const toggle of screen.queryAllByTestId(/^case-suggestion-toggle-/)) {
    fireEvent.click(toggle);
  }
}

function renderBanner(
  props: Partial<React.ComponentProps<typeof CaseChangeSuggestions>> = {}
) {
  const onCaseChanged = vi.fn();
  render(
    <CaseChangeSuggestions
      caseId={12}
      testcase={{ id: 12, name: "Checkout" }}
      currentVersion={3}
      canDecide={true}
      onCaseChanged={onCaseChanged}
      {...props}
    />
  );
  expandAll();
  return { onCaseChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockReturnValue({ data: [update], refetch: mocks.refetch });
  mocks.refetch.mockResolvedValue(undefined);
  mocks.links.mockReturnValue({ data: [], refetch: mocks.refetchLinks });
  mocks.refetchLinks.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(ok({ ok: true, status: "APPLIED" }));
});

describe("fieldValueText", () => {
  it("joins lists and writes everything else as text", () => {
    expect(fieldValueText(["a", "b"])).toBe("a, b");
    expect(fieldValueText(3)).toBe("3");
    expect(fieldValueText(false)).toBe("false");
    expect(fieldValueText(null)).toBe("");
    expect(fieldValueText(undefined)).toBe("");
  });
});

describe("readProposal", () => {
  it("returns the case before and after", () => {
    expect(readProposal(update.proposed)).toEqual({
      base,
      next: {
        name: "Totals include tax",
        fieldValues: update.proposed.fieldValues,
        steps: update.proposed.steps,
      },
    });
  });

  it("reads missing field values as none", () => {
    expect(
      readProposal({ name: "x", steps: [], base })?.next.fieldValues
    ).toEqual({});
  });

  it("is null for a proposal it cannot show", () => {
    for (const bad of [
      null,
      {},
      { name: "x", steps: [] },
      { name: 1, steps: [], base },
      { name: "x", steps: "none", base },
      { name: "x", steps: [], base: { name: "y" } },
    ]) {
      expect(readProposal(bad)).toBeNull();
    }
  });
});

describe("CaseChangeSuggestions", () => {
  it("asks for the case's pending suggestions, oldest first", () => {
    renderBanner();
    expect(mocks.find.mock.calls[0][0]).toMatchObject({
      where: { caseId: 12, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
  });

  it("renders nothing while loading or when there are none", () => {
    mocks.find.mockReturnValue({ data: undefined, refetch: mocks.refetch });
    const loading = render(
      <CaseChangeSuggestions
        caseId={12}
        testcase={{ id: 12, name: "Checkout" }}
        currentVersion={3}
        canDecide={true}
      />
    );
    expect(loading.container).toBeEmptyDOMElement();
    loading.unmount();
    mocks.find.mockReturnValue({ data: [], refetch: mocks.refetch });
    const none = render(
      <CaseChangeSuggestions
        caseId={12}
        testcase={{ id: 12, name: "Checkout" }}
        currentVersion={3}
        canDecide={true}
      />
    );
    expect(none.container).toBeEmptyDOMElement();
  });

  it("starts collapsed: the title and issue show, the change and buttons do not", () => {
    render(
      <CaseChangeSuggestions
        caseId={12}
        testcase={{ id: 12, name: "Checkout" }}
        currentVersion={3}
        canDecide={true}
      />
    );
    const banner = screen.getByTestId("case-suggestion-9");
    expect(banner).toHaveTextContent("updateTitle");
    expect(banner).toHaveTextContent("issueChanged(");
    expect(screen.queryByTestId("case-suggestion-changes-9")).toBeNull();
    expect(screen.queryByTestId("case-suggestion-apply-9")).toBeNull();
    const toggle = screen.getByTestId("case-suggestion-toggle-9");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("case-suggestion-apply-9")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("case-suggestion-apply-9")).toBeNull();
  });

  it("shows an update with its issue, reason and only what changes", () => {
    renderBanner();
    const banner = screen.getByTestId("case-suggestion-9");
    expect(banner).toHaveTextContent("updateTitle");
    expect(banner).toHaveTextContent("issueChanged(DEMO-42: Checkout totals)");
    expect(banner).toHaveTextContent("Tax is now included");
    expect(screen.getAllByTestId("diff").map((n) => n.textContent)).toEqual([
      "Totals add up => Totals include tax",
      "High => Low",
      "Open the cart\nexpectedResult(Total is shown) => Open the cart\nexpectedResult(Total with tax is shown)",
      " => Check out",
    ]);
    expect(banner).toHaveTextContent("step(1)");
    expect(banner).toHaveTextContent("step(3)");
    // Unchanged fields and steps are left out.
    expect(banner).not.toHaveTextContent("Tags");
    expect(banner).not.toHaveTextContent("Notes");
    expect(banner).not.toHaveTextContent("step(2)");
    expect(screen.queryByTestId("case-suggestion-stale-9")).toBeNull();
  });

  it("shows a removed step and a field the proposal adds", () => {
    mocks.find.mockReturnValue({
      data: [
        {
          ...update,
          proposed: {
            ...update.proposed,
            name: base.name,
            fieldValues: { ...base.fieldValues, Severity: "Major" },
            steps: [base.steps[0]],
          },
        },
      ],
      refetch: mocks.refetch,
    });
    renderBanner();
    expect(screen.getAllByTestId("diff").map((n) => n.textContent)).toEqual([
      " => Major",
      "Remove an item => ",
    ]);
  });

  it("shows a retirement with what applying it does and no changes list", () => {
    mocks.find.mockReturnValue({ data: [retire], refetch: mocks.refetch });
    renderBanner();
    const banner = screen.getByTestId("case-suggestion-10");
    expect(banner).toHaveTextContent("retireTitle");
    expect(banner).toHaveTextContent("issueChanged(Local 3)");
    expect(banner).toHaveTextContent("retireDescription");
    expect(screen.queryByTestId("case-suggestion-changes-10")).toBeNull();
  });

  it("shows no changes list for an update whose proposal cannot be read", () => {
    mocks.find.mockReturnValue({
      data: [{ ...update, proposed: { name: "x" } }],
      refetch: mocks.refetch,
    });
    renderBanner();
    expect(screen.getByTestId("case-suggestion-9")).toBeInTheDocument();
    expect(screen.queryByTestId("case-suggestion-changes-9")).toBeNull();
  });

  it("hides the buttons from someone who may not edit the case", () => {
    renderBanner({ canDecide: false });
    expect(screen.getByTestId("case-suggestion-9")).toBeInTheDocument();
    expect(screen.queryByTestId("case-suggestion-apply-9")).toBeNull();
    expect(screen.queryByTestId("case-suggestion-dismiss-9")).toBeNull();
  });

  it("applies a suggestion, tells the page the case changed and reloads the list", async () => {
    const { onCaseChanged } = renderBanner();
    fireEvent.click(screen.getByTestId("case-suggestion-apply-9"));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("applied")
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/repository/cases/12/suggestions/9",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
      }
    );
    expect(onCaseChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
  });

  it("says the case was deleted and leaves the page when a retirement is applied", async () => {
    mocks.find.mockReturnValue({ data: [retire], refetch: mocks.refetch });
    const onCaseDeleted = vi.fn();
    const { onCaseChanged } = renderBanner({ onCaseDeleted });
    fireEvent.click(screen.getByTestId("case-suggestion-delete-10"));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("delete-case-modal")).toHaveTextContent(
      "Checkout"
    );
    fireEvent.click(screen.getByTestId("delete-confirm"));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("retired")
    );
    await waitFor(() =>
      expect(screen.queryByTestId("delete-case-modal")).toBeNull()
    );
    expect(onCaseDeleted).toHaveBeenCalledTimes(1);
    expect(onCaseChanged).not.toHaveBeenCalled();
  });

  it("asks before deleting and does nothing when the dialog is cancelled", () => {
    mocks.find.mockReturnValue({ data: [retire], refetch: mocks.refetch });
    renderBanner();
    expect(screen.queryByTestId("case-suggestion-apply-10")).toBeNull();
    fireEvent.click(screen.getByTestId("case-suggestion-delete-10"));
    fireEvent.click(screen.getByTestId("delete-cancel"));
    expect(screen.queryByTestId("delete-case-modal")).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("applies a retirement without a page callback", async () => {
    mocks.find.mockReturnValue({ data: [retire], refetch: mocks.refetch });
    render(
      <CaseChangeSuggestions
        caseId={12}
        testcase={{ id: 12, name: "Checkout" }}
        currentVersion={3}
        canDecide={true}
      />
    );
    expandAll();
    fireEvent.click(screen.getByTestId("case-suggestion-delete-10"));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("delete-case-modal")).toHaveTextContent(
      "Checkout"
    );
    fireEvent.click(screen.getByTestId("delete-confirm"));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("retired")
    );
    await waitFor(() =>
      expect(screen.queryByTestId("delete-case-modal")).toBeNull()
    );
  });

  it("dismisses without telling the page the case changed", async () => {
    mocks.fetch.mockResolvedValue(ok({ ok: true, status: "DISMISSED" }));
    const { onCaseChanged } = renderBanner();
    fireEvent.click(screen.getByTestId("case-suggestion-dismiss-9"));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("dismissed")
    );
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      action: "dismiss",
    });
    expect(onCaseChanged).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
  });

  it("offers Suggest again in place of Apply once the case has been edited", async () => {
    mocks.fetch.mockResolvedValue(ok({ ok: true, outcome: "suggested" }));
    const { onCaseChanged } = renderBanner({ currentVersion: 4 });
    expect(screen.getByTestId("case-suggestion-stale-9")).toHaveTextContent(
      "stale"
    );
    expect(screen.queryByTestId("case-suggestion-apply-9")).toBeNull();
    expect(screen.getByTestId("case-suggestion-dismiss-9")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("case-suggestion-regenerate-9"));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("regenerated")
    );
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      action: "regenerate",
    });
    expect(onCaseChanged).not.toHaveBeenCalled();
  });

  it("says so when suggesting again finds nothing to change", async () => {
    mocks.fetch.mockResolvedValue(ok({ ok: true, outcome: "up_to_date" }));
    renderBanner({ currentVersion: 4 });
    fireEvent.click(screen.getByTestId("case-suggestion-regenerate-9"));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("nothingToChange")
    );
  });

  it.each(["not_found", "gone", "not_pending", "stale", "no_llm", "failed"])(
    "explains a %s refusal and still reloads the list",
    async (code) => {
      mocks.fetch.mockResolvedValue(refused(code));
      const { onCaseChanged } = renderBanner();
      fireEvent.click(screen.getByTestId("case-suggestion-apply-9"));
      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(`errors.${code}`)
      );
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(onCaseChanged).not.toHaveBeenCalled();
      await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
    }
  );

  it("falls back to a general message for a refusal it does not know, a body that is not JSON, and a failed request", async () => {
    mocks.fetch.mockResolvedValueOnce(refused("teapot"));
    renderBanner();
    fireEvent.click(screen.getByTestId("case-suggestion-apply-9"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    });
    fireEvent.click(screen.getByTestId("case-suggestion-apply-9"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(2));

    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByTestId("case-suggestion-apply-9"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(3));
    expect(mocks.toastError.mock.calls.map((c) => c[0])).toEqual([
      "errors.failed",
      "errors.failed",
      "errors.failed",
    ]);
  });

  it("disables a suggestion's buttons while it is being decided, and only that one's", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.fetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mocks.find.mockReturnValue({
      data: [update, retire],
      refetch: mocks.refetch,
    });
    renderBanner();
    fireEvent.click(screen.getByTestId("case-suggestion-apply-9"));
    await waitFor(() =>
      expect(screen.getByTestId("case-suggestion-apply-9")).toBeDisabled()
    );
    expect(screen.getByTestId("case-suggestion-dismiss-9")).toBeDisabled();
    expect(screen.getByTestId("case-suggestion-delete-10")).toBeEnabled();
    finish(ok({ ok: true, status: "APPLIED" }));
    await waitFor(() =>
      expect(screen.getByTestId("case-suggestion-apply-9")).toBeEnabled()
    );
  });

  it("works without a page callback", async () => {
    render(
      <CaseChangeSuggestions
        caseId={12}
        testcase={{ id: 12, name: "Checkout" }}
        currentVersion={3}
        canDecide={true}
      />
    );
    expandAll();
    fireEvent.click(screen.getByTestId("case-suggestion-apply-9"));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("applied")
    );
  });
});

describe("CaseChangeSuggestions: issues that changed without a suggestion", () => {
  const earlier = "2026-11-20T10:00:00.000Z";
  const later = "2026-11-24T10:00:00.000Z";
  const link = (
    issueId: number,
    extra: {
      alignedAt?: string;
      contentUpdatedAt?: string | null;
      isDeleted?: boolean;
    } = {}
  ) => ({
    issueId,
    alignedAt: extra.alignedAt ?? earlier,
    issue: {
      id: issueId,
      name: `DEMO-${issueId}`,
      title: `Issue ${issueId}`,
      externalUrl: "https://jira.example/x",
      contentUpdatedAt:
        extra.contentUpdatedAt === undefined ? later : extra.contentUpdatedAt,
      isDeleted: extra.isDeleted ?? false,
    },
  });

  beforeEach(() => {
    mocks.find.mockReturnValue({ data: [], refetch: mocks.refetch });
    mocks.fetch.mockResolvedValue(ok({ alignedAt: later }));
  });

  it("asks only for links that have ever been aligned", () => {
    renderBanner();
    expect(mocks.links.mock.calls[0][0].where).toEqual({
      caseId: 12,
      alignedAt: { not: null },
    });
  });

  it("flags an issue whose text is newer than the case, and nothing else", () => {
    mocks.links.mockReturnValue({
      data: [
        link(200),
        link(201, { alignedAt: later, contentUpdatedAt: earlier }),
        link(202, { contentUpdatedAt: null }),
        link(203, { isDeleted: true }),
      ],
      refetch: mocks.refetchLinks,
    });
    renderBanner();
    expect(screen.getByTestId("case-issue-changed-200")).toHaveTextContent(
      "issueChangedUnchecked(DEMO-200: Issue 200)"
    );
    for (const id of [201, 202, 203]) {
      expect(screen.queryByTestId(`case-issue-changed-${id}`)).toBeNull();
    }
  });

  it("leaves the notice to the suggestion when the issue has one waiting", () => {
    mocks.find.mockReturnValue({ data: [update], refetch: mocks.refetch });
    mocks.links.mockReturnValue({
      data: [link(100), link(200)],
      refetch: mocks.refetchLinks,
    });
    renderBanner();
    expect(screen.queryByTestId("case-issue-changed-100")).toBeNull();
    expect(screen.getByTestId("case-issue-changed-200")).toBeInTheDocument();
    expect(screen.getByTestId("case-suggestion-9")).toBeInTheDocument();
  });

  it("shows the notice while the suggestions are still loading", () => {
    mocks.find.mockReturnValue({ data: undefined, refetch: mocks.refetch });
    mocks.links.mockReturnValue({
      data: [link(200)],
      refetch: mocks.refetchLinks,
    });
    renderBanner();
    expect(screen.getByTestId("case-issue-changed-200")).toBeInTheDocument();
  });

  it("renders nothing while the links load and there is nothing else to show", () => {
    mocks.links.mockReturnValue({
      data: undefined,
      refetch: mocks.refetchLinks,
    });
    const view = render(
      <CaseChangeSuggestions
        caseId={12}
        testcase={{ id: 12, name: "Checkout" }}
        currentVersion={3}
        canDecide={true}
      />
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it("marks the case as up to date on the server and reloads the links", async () => {
    mocks.links.mockReturnValue({
      data: [link(200)],
      refetch: mocks.refetchLinks,
    });
    renderBanner();
    fireEvent.click(screen.getByTestId("case-issue-mark-aligned-200"));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("markedAligned")
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/repository-cases/12/issue-alignment",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: 200 }),
      }
    );
    await waitFor(() => expect(mocks.refetchLinks).toHaveBeenCalledTimes(1));
  });

  it("says so when marking fails, whether the server refuses or the request does not get there", async () => {
    mocks.links.mockReturnValue({
      data: [link(200)],
      refetch: mocks.refetchLinks,
    });
    renderBanner();
    mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    fireEvent.click(screen.getByTestId("case-issue-mark-aligned-200"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByTestId("case-issue-mark-aligned-200"));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(2));
    expect(mocks.toastError).toHaveBeenLastCalledWith("markAlignedFailed");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("disables the button while marking, and hides it from someone who may not edit", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.fetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mocks.links.mockReturnValue({
      data: [link(200), link(204)],
      refetch: mocks.refetchLinks,
    });
    const view = render(
      <CaseChangeSuggestions
        caseId={12}
        testcase={{ id: 12, name: "Checkout" }}
        currentVersion={3}
        canDecide={true}
      />
    );
    fireEvent.click(screen.getByTestId("case-issue-mark-aligned-200"));
    await waitFor(() =>
      expect(screen.getByTestId("case-issue-mark-aligned-200")).toBeDisabled()
    );
    expect(screen.getByTestId("case-issue-mark-aligned-204")).toBeEnabled();
    finish(ok({}));
    await waitFor(() =>
      expect(screen.getByTestId("case-issue-mark-aligned-200")).toBeEnabled()
    );
    view.unmount();

    renderBanner({ canDecide: false });
    expect(screen.getByTestId("case-issue-changed-200")).toBeInTheDocument();
    expect(screen.queryByTestId("case-issue-mark-aligned-200")).toBeNull();
  });
});
