import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { MintDialog } from "./MintDialog";

// Mock the server actions module — every test controls the return value.
const mockMintScimTokenAction = vi.fn();
vi.mock("~/app/actions/scimTokenActions", () => ({
  mintScimTokenAction: (...args: unknown[]) =>
    mockMintScimTokenAction(...args),
}));

// Mock sonner — assert on toast.error calls in failure cases without
// requiring a portal target in jsdom.
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
  },
}));

// jsdom does NOT implement navigator.clipboard — patch with a spy that the
// Copy button test reads. Use Object.defineProperty so re-assigning between
// tests is safe.
const mockClipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  mockClipboardWriteText.mockClear();
  mockMintScimTokenAction.mockReset();
  mockToastError.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mockClipboardWriteText },
    configurable: true,
    writable: true,
  });
});

function renderDialog(onOpenChange = vi.fn(), onSuccess = vi.fn()) {
  return {
    user: userEvent.setup(),
    onOpenChange,
    onSuccess,
    ...render(
      <MintDialog
        open={true}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />
    ),
  };
}

describe("MintDialog", () => {
  test("renders the form state with name + idp + expires fields when open", () => {
    renderDialog();

    // Dialog title shows in form state.
    expect(
      screen.getByRole("heading", { name: /admin\.scim\.mint\.title/ })
    ).toBeVisible();

    // Name input is present and required.
    expect(
      screen.getByTestId("scim-mint-dialog-name-input")
    ).toBeInTheDocument();

    // IdP + Expires triggers are present.
    expect(
      screen.getByTestId("scim-mint-dialog-idp-select")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("scim-mint-dialog-expires-select")
    ).toBeInTheDocument();

    // Submit button is present.
    expect(screen.getByTestId("scim-mint-dialog-submit")).toBeInTheDocument();
  });

  test("blocks submit when name is empty + does NOT call mintScimTokenAction", async () => {
    const { user } = renderDialog();

    const submit = screen.getByTestId("scim-mint-dialog-submit");
    await user.click(submit);

    // Validation error visible.
    await waitFor(() => {
      expect(
        screen.getByText(/admin\.scim\.mint\.errorsNameRequired/)
      ).toBeInTheDocument();
    });

    // The action must NOT have been called for a blocked form.
    expect(mockMintScimTokenAction).not.toHaveBeenCalled();
  });

  test("happy path: submit calls action and reveals token + base-url hint", async () => {
    mockMintScimTokenAction.mockResolvedValueOnce({
      success: true,
      tokenId: "tok-abc",
      plaintext: "tps_LIVE_TOKEN_PLAINTEXT_123",
      tokenPrefix: "tps_LIVE",
    });

    const onSuccess = vi.fn();
    const { user } = renderDialog(vi.fn(), onSuccess);

    // Type into name input.
    const nameInput = screen.getByTestId("scim-mint-dialog-name-input");
    await user.type(nameInput, "Okta production");

    // Submit (idpName + expires options default-resolve to Okta + Never).
    await user.click(screen.getByTestId("scim-mint-dialog-submit"));

    // Reveal state — plaintext rendered in the mono code element.
    await waitFor(() => {
      const tokenEl = screen.getByTestId("scim-mint-dialog-reveal-token");
      expect(tokenEl).toBeVisible();
      expect(tokenEl).toHaveTextContent("tps_LIVE_TOKEN_PLAINTEXT_123");
    });

    // Action called once with the form payload.
    expect(mockMintScimTokenAction).toHaveBeenCalledTimes(1);
    const payload = mockMintScimTokenAction.mock.calls[0][0];
    expect(payload.name).toBe("Okta production");
    expect(payload.idpName).toBe("OKTA");
    expect(payload.expiresAt).toBeNull();

    // Success callback fired with the result.
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toMatchObject({
      tokenId: "tok-abc",
      plaintext: "tps_LIVE_TOKEN_PLAINTEXT_123",
    });

    // Copy button + Close button are in the reveal state.
    expect(screen.getByTestId("scim-mint-dialog-copy")).toBeInTheDocument();
    expect(screen.getByTestId("scim-mint-dialog-close")).toBeInTheDocument();
  });

  test("Copy button writes plaintext to clipboard", async () => {
    mockMintScimTokenAction.mockResolvedValueOnce({
      success: true,
      tokenId: "tok-abc",
      plaintext: "tps_COPYABLE_VALUE",
      tokenPrefix: "tps_COPY",
    });

    const { user } = renderDialog();
    // user-event 14 calls `setup()` which monkey-patches navigator.clipboard
    // with its own stub. Re-install our spy AFTER renderDialog() runs so the
    // click handler hits our mock.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockClipboardWriteText },
      configurable: true,
      writable: true,
    });

    await user.type(
      screen.getByTestId("scim-mint-dialog-name-input"),
      "Entra prod"
    );
    await user.click(screen.getByTestId("scim-mint-dialog-submit"));

    // Wait for reveal state.
    await waitFor(() => {
      expect(
        screen.getByTestId("scim-mint-dialog-reveal-token")
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("scim-mint-dialog-copy"));

    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    expect(mockClipboardWriteText).toHaveBeenCalledWith("tps_COPYABLE_VALUE");
  });

  test("Close in reveal state fires onOpenChange(false)", async () => {
    mockMintScimTokenAction.mockResolvedValueOnce({
      success: true,
      tokenId: "tok-abc",
      plaintext: "tps_CLOSE_ME",
      tokenPrefix: "tps_CLOSE",
    });

    const onOpenChange = vi.fn();
    const { user } = renderDialog(onOpenChange);

    await user.type(
      screen.getByTestId("scim-mint-dialog-name-input"),
      "OneLogin"
    );
    await user.click(screen.getByTestId("scim-mint-dialog-submit"));

    await waitFor(() => {
      expect(
        screen.getByTestId("scim-mint-dialog-reveal-token")
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("scim-mint-dialog-close"));

    // Parent receives the close signal.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("re-opening after close discards plaintext (show-once invariant)", async () => {
    mockMintScimTokenAction.mockResolvedValueOnce({
      success: true,
      tokenId: "tok-abc",
      plaintext: "tps_ONESHOT",
      tokenPrefix: "tps_ONES",
    });

    const onOpenChangeSpy = vi.fn();
    const { rerender } = render(
      <MintDialog
        open={true}
        onOpenChange={onOpenChangeSpy}
        onSuccess={vi.fn()}
      />
    );

    const ue = userEvent.setup();
    await ue.type(
      screen.getByTestId("scim-mint-dialog-name-input"),
      "OneShot"
    );
    await ue.click(screen.getByTestId("scim-mint-dialog-submit"));

    await waitFor(() => {
      expect(
        screen.getByTestId("scim-mint-dialog-reveal-token")
      ).toHaveTextContent("tps_ONESHOT");
    });

    // Close + re-open by toggling the `open` prop. The reveal token MUST
    // no longer be in the DOM — the form state renders again with no
    // residual plaintext.
    rerender(
      <MintDialog
        open={false}
        onOpenChange={onOpenChangeSpy}
        onSuccess={vi.fn()}
      />
    );
    rerender(
      <MintDialog
        open={true}
        onOpenChange={onOpenChangeSpy}
        onSuccess={vi.fn()}
      />
    );

    // Confirmed: no plaintext element survives the close → re-open cycle.
    expect(
      screen.queryByTestId("scim-mint-dialog-reveal-token")
    ).not.toBeInTheDocument();

    // And the form input is back, blank.
    const nameInputAfter = screen.getByTestId(
      "scim-mint-dialog-name-input"
    ) as HTMLInputElement;
    expect(nameInputAfter.value).toBe("");
  });

  test("submit failure stays in form state + surfaces toast.error", async () => {
    mockMintScimTokenAction.mockResolvedValueOnce({
      success: false,
      error: "A token with that name already exists",
    });

    const { user } = renderDialog();

    await user.type(
      screen.getByTestId("scim-mint-dialog-name-input"),
      "dup-name"
    );
    await user.click(screen.getByTestId("scim-mint-dialog-submit"));

    await waitFor(() => {
      expect(mockMintScimTokenAction).toHaveBeenCalledTimes(1);
    });

    // No reveal element (still in form state).
    expect(
      screen.queryByTestId("scim-mint-dialog-reveal-token")
    ).not.toBeInTheDocument();

    // Toast error fired with the action's error string.
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });
});
