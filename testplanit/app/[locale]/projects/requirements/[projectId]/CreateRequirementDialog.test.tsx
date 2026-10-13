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
  DeferredIssueManager: ({
    linkedIssueIds,
    onIssuesChange,
    label,
    triggerLabel,
  }: any) => {
    capturedOnIssuesChange = onIssuesChange;
    capturedLinkedIssueIds = linkedIssueIds;
    return (
      <div data-testid="mock-deferred-issue-manager" data-label={label}>
        <span data-testid="mock-deferred-issue-manager-trigger-label">
          {triggerLabel}
        </span>
        {(linkedIssueIds ?? []).map((id: number) => (
          <span key={id} data-testid={`mock-linked-issue-${id}`} />
        ))}
      </div>
    );
  },
}));

// The promotion picker is stubbed to a props recorder: the tests drive
// `onIssueSelected` directly, the way the real dialog would on a click.
let capturedPickerProps: Record<string, any> | null = null;
vi.mock("@/components/issues/requirement-reference-search-dialog", () => ({
  RequirementReferenceSearchDialog: (props: any) => {
    capturedPickerProps = props;
    return <div data-testid="mock-promotion-picker" />;
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
    capturedPickerProps = null;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: true }),
    }) as any;
  });

  describe("promote an existing issue", () => {
    const openPromoteTab = () => {
      // Radix Tabs activates a trigger on mousedown (automatic activation
      // mode), so a bare click event never switches tabs under jsdom.
      const trigger = screen.getByTestId("create-requirement-mode-promote");
      fireEvent.mouseDown(trigger, { button: 0 });
      fireEvent.click(trigger);
    };

    it("mounts the picker in promotableOnly mode and enables submit only once an issue is picked", () => {
      render(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={vi.fn()}
        />
      );
      openPromoteTab();

      // The picker is restricted to this project's synced, non-requirement
      // rows — the only rows the override route can promote.
      expect(capturedPickerProps?.promotableOnly).toBe(true);
      expect(capturedPickerProps?.projectId).toBe(7);
      expect(screen.getByTestId("create-requirement-submit")).toBeDisabled();
      expect(
        screen.getByTestId("create-requirement-promote-target")
      ).toHaveTextContent("requirements.create.promoteNoneSelected");

      fireEvent.click(screen.getByTestId("create-requirement-promote-pick"));
      expect(capturedPickerProps?.open).toBe(true);

      act(() => {
        capturedPickerProps?.onIssueSelected?.({
          isExternal: false,
          id: 12036,
          name: "ABT-47364",
          title: "Content details loader lock",
          externalKey: "ABT-47364",
          description: null,
          status: "Open",
          priority: null,
          externalId: "47364",
          externalUrl: null,
          externalStatus: "Open",
        });
      });

      expect(
        screen.getByTestId("create-requirement-promote-target")
      ).toHaveTextContent("ABT-47364: Content details loader lock");
      expect(screen.getByTestId("create-requirement-submit")).toBeEnabled();
      expect(screen.getByTestId("create-requirement-submit")).toHaveTextContent(
        "requirements.create.promoteSubmit"
      );
    });

    it("promotes through the override route, never the create mutation, and reports the issue's own id", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ id: 42 });
      useCreateIssueMock.mockReturnValue({ mutateAsync });
      const onOpenChange = vi.fn();
      const onCreated = vi.fn();

      render(
        <CreateRequirementDialog
          projectId="7"
          parentId={99}
          parentName="Some parent"
          open
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      );
      openPromoteTab();
      act(() => {
        capturedPickerProps?.onIssueSelected?.({
          isExternal: false,
          id: 12036,
          name: "ABT-47364",
          title: "t",
          externalKey: "ABT-47364",
          description: null,
          status: null,
          priority: null,
          externalId: null,
          externalUrl: null,
          externalStatus: null,
        });
      });
      fireEvent.click(screen.getByTestId("create-requirement-submit"));
      // The conversion confirms first; nothing is posted until then.
      expect(global.fetch).not.toHaveBeenCalled();
      expect(
        screen.getByTestId("requirement-override-dialog")
      ).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("requirement-override-confirm"));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/projects/7/requirements/12036/override",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ override: "FORCE_ON" }),
          }
        );
      });
      // The tree's "Add child" parent is NOT applied: a synced issue's
      // hierarchy is the tracker's, and nothing is created.
      expect(mutateAsync).not.toHaveBeenCalled();
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(onCreated).toHaveBeenCalledWith(12036);
      expect(toast.success).toHaveBeenCalledWith(
        "requirements.create.promoteSuccess"
      );
    });

    it("keeps the dialog open and reports failure when the route rejects", async () => {
      (global.fetch as any) = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });
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
      openPromoteTab();
      act(() => {
        capturedPickerProps?.onIssueSelected?.({
          isExternal: false,
          id: 5,
          name: "X-5",
          title: "t",
          externalKey: "X-5",
          description: null,
          status: null,
          priority: null,
          externalId: null,
          externalUrl: null,
          externalStatus: null,
        });
      });
      fireEvent.click(screen.getByTestId("create-requirement-submit"));
      fireEvent.click(screen.getByTestId("requirement-override-confirm"));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "requirements.create.promoteFailed"
        )
      );
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(onCreated).not.toHaveBeenCalled();
    });

    it("re-opens on the create tab with the promotion target cleared", () => {
      const { rerender } = render(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={vi.fn()}
        />
      );
      openPromoteTab();
      act(() => {
        capturedPickerProps?.onIssueSelected?.({
          isExternal: false,
          id: 5,
          name: "X-5",
          title: "t",
          externalKey: "X-5",
          description: null,
          status: null,
          priority: null,
          externalId: null,
          externalUrl: null,
          externalStatus: null,
        });
      });
      expect(
        screen.getByTestId("create-requirement-promote-target")
      ).toHaveTextContent("X-5");

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

      // Back on the create tab: the name input is the active surface again.
      expect(
        screen.getByTestId("create-requirement-name-input")
      ).toBeInTheDocument();
      openPromoteTab();
      expect(
        screen.getByTestId("create-requirement-promote-target")
      ).toHaveTextContent("requirements.create.promoteNoneSelected");
    });
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
    it("passes a neutral trigger label to the References DeferredIssueManager", () => {
      render(
        <CreateRequirementDialog
          projectId="7"
          parentId={null}
          open
          onOpenChange={vi.fn()}
        />
      );

      expect(
        screen.getByTestId("mock-deferred-issue-manager-trigger-label")
      ).toHaveTextContent("issues.linkIssue");
    });

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
