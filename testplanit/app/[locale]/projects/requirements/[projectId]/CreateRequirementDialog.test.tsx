import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "test-user-1" } } }),
}));

const { useCreateIssueMock } = vi.hoisted(() => ({
  useCreateIssueMock: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 42 }),
  })),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useCreate: useCreateIssueMock,
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

let capturedOnIssuesChange: ((ids: number[]) => void) | null = null;
let capturedLinkedIssueIds: number[] | null = null;
vi.mock("@/components/issues/DeferredIssueManager", () => ({
  DeferredIssueManager: ({ linkedIssueIds, onIssuesChange, label }: any) => {
    capturedOnIssuesChange = onIssuesChange;
    capturedLinkedIssueIds = linkedIssueIds;
    return (
      <div data-testid="mock-deferred-issue-manager" data-label={label}>
        {(linkedIssueIds ?? []).map((id: number) => (
          <span key={id} data-testid={`mock-linked-issue-${id}`} />
        ))}
      </div>
    );
  },
}));

import { toast } from "sonner";
import { CreateRequirementDialog } from "./CreateRequirementDialog";

describe("CreateRequirementDialog", () => {
  beforeEach(() => {
    useCreateIssueMock.mockReset();
    useCreateIssueMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: 42 }),
    });
    capturedOnIssuesChange = null;
    capturedLinkedIssueIds = null;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: true }),
    }) as any;
  });

  it("submits on Return in the name field", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ id: 42 });
    useCreateIssueMock.mockReturnValue({ mutateAsync });
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();

    render(
      <CreateRequirementDialog
        projectId="7"
        parentId={null}
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    );

    const input = screen.getByTestId("create-requirement-name-input");
    fireEvent.change(input, { target: { value: "  New requirement  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "New requirement",
        title: "New requirement",
        isRequirement: true,
        project: { connect: { id: 7 } },
        createdBy: { connect: { id: "test-user-1" } },
      }),
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).toHaveBeenCalledWith(42);
  });

  it("does nothing on Return with a blank/whitespace-only name", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ id: 42 });
    useCreateIssueMock.mockReturnValue({ mutateAsync });
    const onOpenChange = vi.fn();

    render(
      <CreateRequirementDialog
        projectId="7"
        parentId={null}
        open
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByTestId("create-requirement-name-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Give any stray async work a tick to run, then assert nothing fired.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-requirement-dialog")).toBeInTheDocument();
  });

  it("carries parent.connect.id for a child create, and no parent key for a root create", async () => {
    const childMutateAsync = vi.fn().mockResolvedValue({ id: 43 });
    useCreateIssueMock.mockReturnValue({ mutateAsync: childMutateAsync });
    const { unmount } = render(
      <CreateRequirementDialog
        projectId="7"
        parentId={5}
        open
        onOpenChange={vi.fn()}
      />
    );

    const childInput = screen.getByTestId("create-requirement-name-input");
    fireEvent.change(childInput, { target: { value: "Child requirement" } });
    fireEvent.keyDown(childInput, { key: "Enter" });

    await waitFor(() => expect(childMutateAsync).toHaveBeenCalledTimes(1));
    expect(childMutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({
        parent: { connect: { id: 5 } },
      }),
    });
    unmount();

    const rootMutateAsync = vi.fn().mockResolvedValue({ id: 44 });
    useCreateIssueMock.mockReturnValue({ mutateAsync: rootMutateAsync });
    render(
      <CreateRequirementDialog
        projectId="7"
        parentId={null}
        open
        onOpenChange={vi.fn()}
      />
    );

    const rootInput = screen.getByTestId("create-requirement-name-input");
    fireEvent.change(rootInput, { target: { value: "Root requirement" } });
    fireEvent.keyDown(rootInput, { key: "Enter" });

    await waitFor(() => expect(rootMutateAsync).toHaveBeenCalledTimes(1));
    const rootPayload = rootMutateAsync.mock.calls[0][0];
    expect(rootPayload.data).not.toHaveProperty("parent");
  });

  it("carries the Return hint as a title exactly when the button is enabled -- one decision, not two", () => {
    // The visible kbd glyph was removed by operator UAT ruling (the Create
    // button carries no icon); the Return affordance survives as the
    // button's title tooltip, still gated on the same canSubmit decision.
    render(
      <CreateRequirementDialog
        projectId="7"
        parentId={null}
        open
        onOpenChange={vi.fn()}
      />
    );

    const submitButton = screen.getByTestId("create-requirement-submit");
    expect(submitButton).toBeDisabled();
    expect(submitButton).not.toHaveAttribute("title");
    expect(
      screen.queryByTestId("create-requirement-submit-hint")
    ).not.toBeInTheDocument();

    const input = screen.getByTestId("create-requirement-name-input");
    fireEvent.change(input, { target: { value: "New requirement" } });

    expect(submitButton).toBeEnabled();
    expect(submitButton).toHaveAttribute(
      "title",
      "requirements.create.submitHint"
    );
    // Still no visible glyph -- the hint is title-only now.
    expect(
      screen.queryByTestId("create-requirement-submit-hint")
    ).not.toBeInTheDocument();
  });

  it("keeps the hint out of the button's accessible name", () => {
    render(
      <CreateRequirementDialog
        projectId="7"
        parentId={null}
        open
        onOpenChange={vi.fn()}
      />
    );

    const input = screen.getByTestId("create-requirement-name-input");
    fireEvent.change(input, { target: { value: "New requirement" } });

    expect(
      screen.getByRole("button", { name: "requirements.create.submit" })
    ).toBeInTheDocument();
  });

  // Proves LINK-03/D-16: references attachable from the Create Requirement
  // dialog via DeferredIssueManager.
  describe("LINK-03 references on create", () => {
    it("clears the picked references every time the dialog re-opens", () => {
      const { rerender } = render(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={vi.fn()}
        />
      );

      expect(capturedLinkedIssueIds).toEqual([]);
      expect(capturedOnIssuesChange).not.toBeNull();

      // Simulate a pick via the mocked DeferredIssueManager's onIssuesChange.
      act(() => {
        capturedOnIssuesChange!([88]);
      });
      rerender(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={vi.fn()}
        />
      );
      expect(capturedLinkedIssueIds).toEqual([88]);

      // Close, then re-open -- the picked reference must not survive.
      rerender(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open={false}
          onOpenChange={vi.fn()}
        />
      );
      rerender(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={vi.fn()}
        />
      );
      expect(capturedLinkedIssueIds).toEqual([]);
    });

    it("attaches each picked reference after the requirement is created", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ id: 42 });
      useCreateIssueMock.mockReturnValue({ mutateAsync });
      const onOpenChange = vi.fn();
      const onCreated = vi.fn();

      render(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      );

      expect(capturedOnIssuesChange).not.toBeNull();
      act(() => {
        capturedOnIssuesChange!([88, 99]);
      });

      const input = screen.getByTestId("create-requirement-name-input");
      fireEvent.change(input, { target: { value: "New requirement" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect((global.fetch as any).mock.calls.length).toBe(2)
      );

      const urls = (global.fetch as any).mock.calls.map(
        ([url]: [string]) => url
      );
      expect(urls).toEqual([
        "/api/projects/7/requirements/42/references",
        "/api/projects/7/requirements/42/references",
      ]);
      const bodies = (global.fetch as any).mock.calls.map(([, init]: any) =>
        JSON.parse(init.body)
      );
      expect(bodies).toEqual(
        expect.arrayContaining([
          { internalIssueId: 88 },
          { internalIssueId: 99 },
        ])
      );

      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(42));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("issues no POST when no references were picked", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ id: 42 });
      useCreateIssueMock.mockReturnValue({ mutateAsync });

      render(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={vi.fn()}
        />
      );

      const input = screen.getByTestId("create-requirement-name-input");
      fireEvent.change(input, { target: { value: "New requirement" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("still creates the requirement when a reference attach call fails", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Failed to attach reference." }),
      }) as any;

      const mutateAsync = vi.fn().mockResolvedValue({ id: 42 });
      useCreateIssueMock.mockReturnValue({ mutateAsync });
      const onOpenChange = vi.fn();
      const onCreated = vi.fn();

      render(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      );

      act(() => {
        capturedOnIssuesChange!([88]);
      });

      const input = screen.getByTestId("create-requirement-name-input");
      fireEvent.change(input, { target: { value: "New requirement" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(42));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(toast.error).toHaveBeenCalledWith(
        "requirements.references.attachFailed"
      );
    });
  });
});
