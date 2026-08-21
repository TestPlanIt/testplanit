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

import { DeleteRequirementModal } from "./DeleteRequirementModal";

describe("DeleteRequirementModal", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deletedIds: [5] }),
    }) as any;
  });

  it("names how many descendants will be soft-deleted alongside the requirement", () => {
    render(
      <DeleteRequirementModal
        projectId="7"
        requirementId={5}
        descendantCount={3}
        open
        onOpenChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("delete-requirement-dialog")).toHaveTextContent(
      "requirements.delete.confirmWithChildren:3"
    );
  });

  it("posts to the delete-subtree route rather than deleting client-side", async () => {
    render(
      <DeleteRequirementModal
        projectId="7"
        requirementId={5}
        descendantCount={0}
        open
        onOpenChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("delete-requirement-confirm"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/7/requirements/5/delete-subtree",
        { method: "POST" }
      );
    });
  });

  it("uses an AlertDialog and never a native confirm dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onOpenChange = vi.fn();

    render(
      <DeleteRequirementModal
        projectId="7"
        requirementId={5}
        descendantCount={0}
        open
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByTestId("delete-requirement-confirm"));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("surfaces a failed delete without closing the dialog", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();

    render(
      <DeleteRequirementModal
        projectId="7"
        requirementId={5}
        descendantCount={0}
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />
    );

    fireEvent.click(screen.getByTestId("delete-requirement-confirm"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByTestId("delete-requirement-dialog")).toBeInTheDocument();
  });
});
