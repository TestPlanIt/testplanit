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

const { mockRotate } = vi.hoisted(() => ({ mockRotate: vi.fn() }));

vi.mock("~/app/actions/scimTokenActions", () => ({
  rotateScimTokenAction: mockRotate,
}));

import { toast } from "sonner";

import { RotateDialog } from "./RotateDialog";

const HOUR_MS = 3_600_000;

function renderDialog(
  overrides: Partial<Parameters<typeof RotateDialog>[0]> = {}
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    tokenId: "tk_1",
    tokenName: "Okta production",
    onRotated: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<RotateDialog {...props} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRotate.mockResolvedValue({
    success: true,
    plaintext: "tps_brand_new_value",
    previousTokenExpiresAt: "2026-09-07T12:00:00.000Z",
  });
});

describe("RotateDialog", () => {
  it("D1: rotates with the 24h default when the operator changes nothing", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));

    await waitFor(() =>
      expect(mockRotate).toHaveBeenCalledWith({
        tokenId: "tk_1",
        overlapMs: 24 * HOUR_MS,
      })
    );
  });

  it("D2: 'cut over immediately' sends a zero overlap", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(
      screen.getByTestId("scim-rotate-overlap-select"),
      "none"
    );
    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));

    await waitFor(() =>
      expect(mockRotate).toHaveBeenCalledWith({ tokenId: "tk_1", overlapMs: 0 })
    );
  });

  it("D3: a 7-day window sends the matching millisecond value", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(
      screen.getByTestId("scim-rotate-overlap-select"),
      "7d"
    );
    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));

    await waitFor(() =>
      expect(mockRotate).toHaveBeenCalledWith({
        tokenId: "tk_1",
        overlapMs: 7 * 24 * HOUR_MS,
      })
    );
  });

  it("D4: reveals the replacement bearer exactly once and tells the caller to refetch", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog();

    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));

    await waitFor(() =>
      expect(
        screen.getByTestId("scim-rotate-dialog-reveal-token")
      ).toHaveTextContent("tps_brand_new_value")
    );
    expect(props.onRotated).toHaveBeenCalledTimes(1);
    // The form is gone — there is no way back to re-submit and re-reveal.
    expect(
      screen.queryByTestId("scim-rotate-dialog-submit")
    ).not.toBeInTheDocument();
  });

  it("D5: describes the overlap when one was granted", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));

    await waitFor(() =>
      expect(
        screen.getByText("admin.scim.rotate.revealDescriptionOverlap")
      ).toBeInTheDocument()
    );
  });

  it("D6: warns that the old bearer died when there was no overlap", async () => {
    const user = userEvent.setup();
    mockRotate.mockResolvedValue({
      success: true,
      plaintext: "tps_brand_new_value",
      previousTokenExpiresAt: null,
    });
    renderDialog();

    await user.selectOptions(
      screen.getByTestId("scim-rotate-overlap-select"),
      "none"
    );
    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));

    await waitFor(() =>
      expect(
        screen.getByText("admin.scim.rotate.revealDescriptionImmediate")
      ).toBeInTheDocument()
    );
  });

  it("D7: discards the plaintext when the dialog closes — reopening returns to the form", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog();

    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));
    await waitFor(() =>
      expect(
        screen.getByTestId("scim-rotate-dialog-reveal-token")
      ).toBeInTheDocument()
    );

    rerender(
      <RotateDialog
        open={false}
        onOpenChange={vi.fn()}
        tokenId="tk_1"
        tokenName="Okta production"
        onRotated={vi.fn()}
      />
    );
    rerender(
      <RotateDialog
        open
        onOpenChange={vi.fn()}
        tokenId="tk_1"
        tokenName="Okta production"
        onRotated={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId("scim-rotate-dialog-reveal-token")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("scim-rotate-dialog-submit")).toBeInTheDocument();
  });

  it("D8: surfaces a server error and never enters the reveal state", async () => {
    const user = userEvent.setup();
    mockRotate.mockResolvedValue({
      success: false,
      error: "Failed to rotate SCIM token",
    });
    renderDialog();

    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to rotate SCIM token")
    );
    expect(
      screen.queryByTestId("scim-rotate-dialog-reveal-token")
    ).not.toBeInTheDocument();
  });

  it("D9: does nothing when no token is selected", async () => {
    const user = userEvent.setup();
    renderDialog({ tokenId: null });

    await user.click(screen.getByTestId("scim-rotate-dialog-submit"));

    expect(mockRotate).not.toHaveBeenCalled();
  });
});
