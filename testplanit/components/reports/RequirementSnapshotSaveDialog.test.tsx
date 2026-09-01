// The snapshot capture dialog: the one place a snapshot gets named and
// posted. The seams under test are the request it sends (name trimmed,
// note nulled when blank, scope forwarded only when non-empty) and what
// happens on either outcome — a failure must keep the dialog open with
// its text intact rather than closing on a toast.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastSuccess, toastError, invalidateQueries } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

import { RequirementSnapshotSaveDialog } from "./RequirementSnapshotSaveDialog";

describe("RequirementSnapshotSaveDialog", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    invalidateQueries.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderDialog(
    props: Partial<
      React.ComponentProps<typeof RequirementSnapshotSaveDialog>
    > = {}
  ) {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <RequirementSnapshotSaveDialog
        projectId={42}
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        {...props}
      />
    );
    return { onOpenChange, onSaved };
  }

  it("keeps Save disabled until a non-blank name is typed", () => {
    renderDialog();
    const submit = screen.getByTestId("requirement-snapshot-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("requirement-snapshot-name"), {
      target: { value: "   " },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("requirement-snapshot-name"), {
      target: { value: "Release 2.4" },
    });
    expect(submit).not.toBeDisabled();
  });

  it("posts the trimmed name, a null blank note, and no scope key for a whole-project capture", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 7,
        name: "Release 2.4",
        capturedAt: "2026-09-01T00:00:00.000Z",
      }),
    });
    const { onOpenChange, onSaved } = renderDialog();

    fireEvent.change(screen.getByTestId("requirement-snapshot-name"), {
      target: { value: "  Release 2.4  " },
    });
    fireEvent.change(screen.getByTestId("requirement-snapshot-note"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByTestId("requirement-snapshot-submit"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/42/requirements/snapshots",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ name: "Release 2.4", note: null });
    expect(toastSuccess).toHaveBeenCalledWith("snapshotSaved:Release 2.4");
    expect(invalidateQueries).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, name: "Release 2.4" })
    );
  });

  it("forwards a non-empty scope and says so in the description", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 8, name: "Scoped", capturedAt: "x" }),
    });
    renderDialog({ requirementIds: [4451, 12] });

    expect(screen.getByText(/saveSnapshotScoped/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("requirement-snapshot-name"), {
      target: { value: "Scoped" },
    });
    fireEvent.click(screen.getByTestId("requirement-snapshot-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.requirementIds).toEqual([4451, 12]);
  });

  it("stays open with an error toast when the capture fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    const { onOpenChange, onSaved } = renderDialog();

    fireEvent.change(screen.getByTestId("requirement-snapshot-name"), {
      target: { value: "Release 2.4" },
    });
    fireEvent.click(screen.getByTestId("requirement-snapshot-submit"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("snapshotSaveFailed")
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId("requirement-snapshot-name")).toHaveValue(
      "Release 2.4"
    );
    expect(
      screen.getByTestId("requirement-snapshot-submit")
    ).not.toBeDisabled();
  });
});
