import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/components/ui/select", async () =>
  (await import("~/__tests__/helpers/radixSelectMock")).createSelectMock()
);

vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => <span>{userId}</span>,
}));

const { mockPreview, mockSave, mockRefetch, mappingsRef } = vi.hoisted(() => ({
  mockPreview: vi.fn(),
  mockSave: vi.fn(),
  mockRefetch: vi.fn(),
  mappingsRef: { current: [] as Array<Record<string, unknown>> },
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    scimRoleMapping: {
      useFindMany: () => ({
        data: mappingsRef.current,
        isLoading: false,
        refetch: mockRefetch,
      }),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("~/app/actions/scimRoleMappingActions", () => ({
  previewRoleMappingChange: mockPreview,
  saveRoleMappingChange: mockSave,
}));

import { toast } from "sonner";

import { RoleMappingsCard } from "./RoleMappingsCard";

beforeEach(() => {
  vi.clearAllMocks();
  mappingsRef.current = [];
  mockPreview.mockResolvedValue({ success: true, downgraded: [] });
  mockSave.mockResolvedValue({ success: true });
  mockRefetch.mockResolvedValue(undefined);
});

describe("RoleMappingsCard", () => {
  it("R1: shows the empty state when no role mappings exist", () => {
    render(<RoleMappingsCard />);

    expect(
      screen.getByText("admin.scim.roleMappings.empty")
    ).toBeInTheDocument();
  });

  it("R2: renders a row per existing mapping", () => {
    mappingsRef.current = [
      { roleValue: "qa-lead", mappedAccess: "PROJECTADMIN" },
      { roleValue: "contractor", mappedAccess: "USER" },
    ];

    render(<RoleMappingsCard />);

    expect(
      screen.getByTestId("scim-role-mapping-row-qa-lead")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("scim-role-mapping-row-contractor")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("admin.scim.roleMappings.empty")
    ).not.toBeInTheDocument();
  });

  it("R3: adding a mapping previews first, then saves", async () => {
    const user = userEvent.setup();
    render(<RoleMappingsCard />);

    await user.type(
      screen.getByTestId("scim-role-mapping-value-input"),
      "qa-lead"
    );
    await user.click(screen.getByTestId("scim-role-mapping-add"));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockPreview).toHaveBeenCalledWith("qa-lead", "USER");
    expect(mockSave).toHaveBeenCalledWith("qa-lead", "USER");
  });

  it("R4: refuses to save a blank role value and never calls the server", async () => {
    const user = userEvent.setup();
    render(<RoleMappingsCard />);

    // The Add button is enabled only once something is typed; type a space so
    // the click lands and the trim guard is what rejects it.
    await user.type(screen.getByTestId("scim-role-mapping-value-input"), "   ");
    await user.click(screen.getByTestId("scim-role-mapping-add"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "admin.scim.roleMappings.errorRoleRequired"
      )
    );
    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("R5: a previewed downgrade blocks the save until confirmed", async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue({
      success: true,
      downgraded: [
        {
          userId: "u1",
          name: "Ann",
          currentAccess: "ADMIN",
          newAccess: "USER",
        },
      ],
    });

    render(<RoleMappingsCard />);
    await user.type(
      screen.getByTestId("scim-role-mapping-value-input"),
      "qa-lead"
    );
    await user.click(screen.getByTestId("scim-role-mapping-add"));

    // Confirmation dialog is up; nothing written yet.
    await waitFor(() =>
      expect(
        screen.getByText("admin.groups.downgradeConfirmTitle")
      ).toBeInTheDocument()
    );
    expect(mockSave).not.toHaveBeenCalled();

    await user.click(
      screen.getByText("admin.groups.downgradeConfirmApplyAnyway")
    );

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith("qa-lead", "USER")
    );
  });

  it("R6: removing a mapping saves a null tier", async () => {
    const user = userEvent.setup();
    mappingsRef.current = [
      { roleValue: "qa-lead", mappedAccess: "PROJECTADMIN" },
    ];

    render(<RoleMappingsCard />);
    await user.click(screen.getByTestId("scim-role-mapping-delete-qa-lead"));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith("qa-lead", null));
  });

  it("R7: surfaces a server error instead of reporting success", async () => {
    const user = userEvent.setup();
    mockSave.mockResolvedValue({ success: false, error: "Unauthorized" });

    render(<RoleMappingsCard />);
    await user.type(
      screen.getByTestId("scim-role-mapping-value-input"),
      "qa-lead"
    );
    await user.click(screen.getByTestId("scim-role-mapping-add"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Unauthorized")
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
