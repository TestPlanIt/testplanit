import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div role="dialog">{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...rest}
    />
  ),
}));
vi.mock("@/components/ui/help-popover", () => ({ HelpPopover: () => null }));

const upsertRepository = vi.fn();
const updateRepository = vi.fn();
let liveRepositories: Array<{ id: number; name: string }> = [];
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    codeRepository: {
      useUpsert: () => ({ mutateAsync: upsertRepository }),
      useUpdate: () => ({ mutateAsync: updateRepository }),
      useFindMany: () => ({ data: liveRepositories }),
    },
  }),
}));

import { toast } from "sonner";
import { CodeRepositoryModal } from "./CodeRepositoryModal";

const existing = {
  id: 9,
  name: "iOS Repository",
  provider: "GITHUB",
  settings: { owner: "acme", repo: "ios" },
  status: "ACTIVE",
};

function submit() {
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
}

describe("CodeRepositoryModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertRepository.mockResolvedValue({});
    updateRepository.mockResolvedValue({});
    liveRepositories = [
      { id: 9, name: "iOS Repository" },
      { id: 3, name: "Payments API" },
    ];
  });

  it("starts an edit with blank secrets that say blank keeps the stored value", () => {
    render(
      <CodeRepositoryModal
        repository={existing}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const token = screen.getByPlaceholderText(
      "admin.integrations.config.leaveBlankToKeep"
    ) as HTMLInputElement;
    expect(token.type).toBe("password");
    expect(token.value).toBe("");
    expect(screen.getByDisplayValue("acme")).toBeInTheDocument();
  });

  it("saves an edit without credentials when no secret was retyped", async () => {
    const onSaved = vi.fn();
    render(
      <CodeRepositoryModal
        repository={existing}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    submit();

    await waitFor(() => expect(updateRepository).toHaveBeenCalledTimes(1));
    const { data } = updateRepository.mock.calls[0][0];
    expect(data).not.toHaveProperty("credentials");
    expect(data).toMatchObject({ name: "iOS Repository", status: "ACTIVE" });
    expect(onSaved).toHaveBeenCalled();
  });

  it("sends only the retyped secret on edit", async () => {
    render(
      <CodeRepositoryModal
        repository={existing}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText("admin.integrations.config.leaveBlankToKeep"),
      { target: { value: "ghp_new" } }
    );
    submit();

    await waitFor(() => expect(updateRepository).toHaveBeenCalledTimes(1));
    expect(updateRepository.mock.calls[0][0].data.credentials).toEqual({
      personalAccessToken: "ghp_new",
    });
  });

  it("refuses a new repository named like a live one", async () => {
    render(<CodeRepositoryModal onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(
      screen.getByPlaceholderText("admin.codeRepositories.namePlaceholder"),
      {
        target: { value: "payments api" },
      }
    );
    submit();

    expect(
      await screen.findByText("admin.codeRepositories.validation.nameUnique")
    ).toBeInTheDocument();
    expect(upsertRepository).not.toHaveBeenCalled();
  });

  it("creates a new repository through the name-keyed upsert", async () => {
    render(<CodeRepositoryModal onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(
      screen.getByPlaceholderText("admin.codeRepositories.namePlaceholder"),
      {
        target: { value: "Billing API" },
      }
    );
    fireEvent.change(screen.getByPlaceholderText("ghp_..."), {
      target: { value: "ghp_tok" },
    });
    submit();

    await waitFor(() => expect(upsertRepository).toHaveBeenCalledTimes(1));
    const args = upsertRepository.mock.calls[0][0];
    expect(args.where).toEqual({ name: "Billing API" });
    expect(args.create).toMatchObject({
      name: "Billing API",
      provider: "GITHUB",
      credentials: { personalAccessToken: "ghp_tok" },
    });
    expect(toast.success).toHaveBeenCalledWith(
      "admin.codeRepositories.repositoryCreated"
    );
  });
});
