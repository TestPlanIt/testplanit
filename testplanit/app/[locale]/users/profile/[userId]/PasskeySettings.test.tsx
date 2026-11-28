import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseTranslations,
  mockUseFindManyPasskey,
  mockUseDeletePasskey,
  mockUseFindFirstSettings,
  mockUseFindFirstSsoProvider,
  mockBrowserSupportsWebAuthn,
  mockStartRegistration,
  mockToastError,
} = vi.hoisted(() => ({
  mockUseTranslations: vi.fn(),
  mockUseFindManyPasskey: vi.fn(),
  mockUseDeletePasskey: vi.fn(),
  mockUseFindFirstSettings: vi.fn(),
  mockUseFindFirstSsoProvider: vi.fn(),
  mockBrowserSupportsWebAuthn: vi.fn(),
  mockStartRegistration: vi.fn(),
  mockToastError: vi.fn(),
}));

// Last-segment passthrough: t("errors.invalidPassword") renders
// "invalidPassword", keeping selectors independent of the en-US copy.
vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    passkey: {
      useFindMany: mockUseFindManyPasskey,
      useDelete: mockUseDeletePasskey,
    },
    registrationSettings: { useFindFirst: mockUseFindFirstSettings },
    ssoProvider: { useFindFirst: mockUseFindFirstSsoProvider },
  }),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => mockBrowserSupportsWebAuthn(),
  startRegistration: (...args: unknown[]) => mockStartRegistration(...args),
}));

vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: any) => (
    <span data-testid="date-formatter">{String(date)}</span>
  ),
}));

import { PasskeySettings } from "./PasskeySettings";

const OPTIONS_URL = "/api/auth/passkey/register/options";
const VERIFY_URL = "/api/auth/passkey/register/verify";

const mockFetch = vi.fn();
const mockRefetch = vi.fn();
const mockMutateAsync = vi.fn();

const passkeys = [
  {
    id: "passkey-1",
    name: "MacBook",
    createdAt: new Date("2026-11-01"),
    lastUsedAt: new Date("2026-11-20"),
  },
  {
    id: "passkey-2",
    name: "Phone",
    createdAt: new Date("2026-11-05"),
    lastUsedAt: null,
  },
];

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

function renderSettings(
  props: Partial<React.ComponentProps<typeof PasskeySettings>> = {}
) {
  return render(
    <PasskeySettings
      userId="user-1"
      isOwnProfile
      twoFactorEnabled={false}
      {...props}
    />
  );
}

function openAddDialog() {
  fireEvent.click(screen.getByTestId("add-passkey-button"));
}

function fillAddForm({ totp }: { totp?: string } = {}) {
  fireEvent.change(screen.getByTestId("passkey-name-input"), {
    target: { value: "  MacBook  " },
  });
  fireEvent.change(screen.getByTestId("passkey-password-input"), {
    target: { value: "secret" },
  });
  if (totp !== undefined) {
    fireEvent.change(screen.getByTestId("passkey-totp-input"), {
      target: { value: totp },
    });
  }
}

function bodyOf(url: string) {
  const call = mockFetch.mock.calls.find(([calledUrl]) => calledUrl === url);
  return call ? JSON.parse(call[1].body) : undefined;
}

beforeEach(() => {
  mockUseTranslations.mockReturnValue((key: string) => {
    const parts = key.split(".");
    return parts[parts.length - 1];
  });
  mockUseFindManyPasskey.mockReturnValue({
    data: passkeys,
    refetch: mockRefetch,
  });
  mockUseDeletePasskey.mockReturnValue({ mutateAsync: mockMutateAsync });
  mockUseFindFirstSettings.mockReturnValue({ data: { allowPasskeys: true } });
  mockUseFindFirstSsoProvider.mockReturnValue({ data: null });
  mockBrowserSupportsWebAuthn.mockReturnValue(true);
  mockStartRegistration.mockResolvedValue({ id: "new-credential" });
  mockMutateAsync.mockResolvedValue({});

  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) =>
    url === OPTIONS_URL
      ? jsonResponse({
          options: { challenge: "challenge-1" },
          challengeToken: "token-1",
        })
      : jsonResponse({ id: "passkey-3", name: "MacBook" }, true, 201)
  );
  global.fetch = mockFetch as any;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PasskeySettings", () => {
  it("renders nothing for someone who is neither the owner nor an admin", () => {
    const { container } = renderSettings({
      isOwnProfile: false,
      isAdmin: false,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the user's passkeys with when they were created and last used", () => {
    renderSettings();

    const rows = screen.getAllByTestId("passkey-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("MacBook");
    expect(rows[1]).toHaveTextContent("Phone");
    expect(rows[1]).toHaveTextContent("never");
    expect(mockUseFindManyPasskey).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("shows the empty state when there are none", () => {
    mockUseFindManyPasskey.mockReturnValue({ data: [], refetch: mockRefetch });
    renderSettings();

    expect(screen.getByText("noPasskeys")).toBeInTheDocument();
  });

  it("lets an admin remove another user's passkey but not add one", () => {
    renderSettings({ isOwnProfile: false, isAdmin: true });

    expect(screen.queryByTestId("add-passkey-button")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("remove-passkey-button")).toHaveLength(2);
  });

  it("hides Add and explains when an administrator switched passkeys off", () => {
    mockUseFindFirstSettings.mockReturnValue({
      data: { allowPasskeys: false },
    });
    renderSettings();

    expect(screen.queryByTestId("add-passkey-button")).not.toBeInTheDocument();
    expect(screen.getByText("disabledNotice")).toBeInTheDocument();
    expect(screen.getAllByTestId("remove-passkey-button")).toHaveLength(2);
  });

  it("hides Add while Force SSO is on", () => {
    mockUseFindFirstSsoProvider.mockReturnValue({ data: { id: "sso-1" } });
    renderSettings();

    expect(screen.queryByTestId("add-passkey-button")).not.toBeInTheDocument();
    expect(screen.getByText("disabledNotice")).toBeInTheDocument();
  });

  it("hides Add in a browser without passkey support", () => {
    mockBrowserSupportsWebAuthn.mockReturnValue(false);
    renderSettings();

    expect(screen.queryByTestId("add-passkey-button")).not.toBeInTheDocument();
    expect(screen.getByText("notSupported")).toBeInTheDocument();
  });

  describe("adding a passkey", () => {
    it("confirms the password, runs the browser prompt and stores the result", async () => {
      renderSettings();
      openAddDialog();

      expect(screen.getByTestId("add-passkey-submit")).toBeDisabled();
      expect(
        screen.queryByTestId("passkey-totp-input")
      ).not.toBeInTheDocument();

      fillAddForm();
      fireEvent.click(screen.getByTestId("add-passkey-submit"));

      await waitFor(() => {
        expect(bodyOf(VERIFY_URL)).toEqual({
          response: { id: "new-credential" },
          challengeToken: "token-1",
          name: "MacBook",
        });
      });
      expect(bodyOf(OPTIONS_URL)).toEqual({ currentPassword: "secret" });
      expect(mockStartRegistration).toHaveBeenCalledWith({
        optionsJSON: { challenge: "challenge-1" },
      });
      await waitFor(() => {
        expect(
          screen.queryByTestId("passkey-name-input")
        ).not.toBeInTheDocument();
      });
      expect(mockRefetch).toHaveBeenCalled();
    });

    it("also asks for an authenticator code when two-factor is on", async () => {
      renderSettings({ twoFactorEnabled: true });
      openAddDialog();

      fillAddForm();
      expect(screen.getByTestId("add-passkey-submit")).toBeDisabled();

      fillAddForm({ totp: "123456" });
      fireEvent.click(screen.getByTestId("add-passkey-submit"));

      await waitFor(() => {
        expect(bodyOf(OPTIONS_URL)).toEqual({
          currentPassword: "secret",
          totpCode: "123456",
        });
      });
    });

    it("shows the server's reason when the password is refused", async () => {
      mockFetch.mockImplementation(async () =>
        jsonResponse(
          {
            errorCode: "users.profile.passkeys.errors.invalidPassword",
            error: "Invalid current password",
          },
          false
        )
      );
      renderSettings();
      openAddDialog();
      fillAddForm();
      fireEvent.click(screen.getByTestId("add-passkey-submit"));

      expect(await screen.findByTestId("add-passkey-error")).toHaveTextContent(
        "invalidPassword"
      );
      expect(mockStartRegistration).not.toHaveBeenCalled();
      expect(screen.getByTestId("passkey-name-input")).toBeInTheDocument();
    });

    it("says so when the device already holds a passkey for the account", async () => {
      const duplicate = new Error("excluded credential");
      duplicate.name = "InvalidStateError";
      mockStartRegistration.mockRejectedValue(duplicate);
      renderSettings();
      openAddDialog();
      fillAddForm();
      fireEvent.click(screen.getByTestId("add-passkey-submit"));

      expect(await screen.findByTestId("add-passkey-error")).toHaveTextContent(
        "alreadyRegistered"
      );
      expect(bodyOf(VERIFY_URL)).toBeUndefined();
    });

    it("stays quiet when the browser's prompt is dismissed", async () => {
      const dismissed = new Error("cancelled");
      dismissed.name = "NotAllowedError";
      mockStartRegistration.mockRejectedValue(dismissed);
      renderSettings();
      openAddDialog();
      fillAddForm();
      fireEvent.click(screen.getByTestId("add-passkey-submit"));

      await waitFor(() => {
        expect(mockStartRegistration).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.getByTestId("add-passkey-submit")).not.toBeDisabled();
      });
      expect(screen.queryByTestId("add-passkey-error")).not.toBeInTheDocument();
      expect(bodyOf(VERIFY_URL)).toBeUndefined();
    });

    it("shows the server's reason when the new key is refused", async () => {
      mockFetch.mockImplementation(async (url: string) =>
        url === OPTIONS_URL
          ? jsonResponse({
              options: { challenge: "challenge-1" },
              challengeToken: "token-1",
            })
          : jsonResponse(
              {
                errorCode: "users.profile.passkeys.errors.limitReached",
                error: "Too many passkeys",
              },
              false,
              409
            )
      );
      renderSettings();
      openAddDialog();
      fillAddForm();
      fireEvent.click(screen.getByTestId("add-passkey-submit"));

      expect(await screen.findByTestId("add-passkey-error")).toHaveTextContent(
        "limitReached"
      );
      expect(mockRefetch).not.toHaveBeenCalled();
    });
  });

  describe("removing a passkey", () => {
    it("deletes the chosen passkey after confirmation", async () => {
      renderSettings();
      fireEvent.click(screen.getAllByTestId("remove-passkey-button")[1]);
      fireEvent.click(screen.getByTestId("confirm-remove-passkey"));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          where: { id: "passkey-2" },
        });
      });
      await waitFor(() => {
        expect(mockRefetch).toHaveBeenCalled();
      });
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it("reports a removal that fails and keeps the dialog open", async () => {
      mockMutateAsync.mockRejectedValue(new Error("denied"));
      renderSettings();
      fireEvent.click(screen.getAllByTestId("remove-passkey-button")[0]);
      fireEvent.click(screen.getByTestId("confirm-remove-passkey"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("removeFailed");
      });
      expect(screen.getByTestId("confirm-remove-passkey")).toBeInTheDocument();
      expect(mockRefetch).not.toHaveBeenCalled();
    });
  });
});
