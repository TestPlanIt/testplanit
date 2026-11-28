import { act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "~/test/test-utils";

// Mock simple-icons
vi.mock("simple-icons", () => ({
  siGoogle: { path: "M1 1" },
  siApple: { path: "M2 2" },
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
}));

// Mock ~/lib/navigation (in addition to next/navigation which is already globally mocked)
const mockRouterPush = vi.fn();
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock ZenStack SSO provider hook
const mockUseFindManySsoProvider = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    ssoProvider: {
      useFindMany: (...args: any[]) => mockUseFindManySsoProvider(...args),
    },
    registrationSettings: {
      useFindFirst: (...args: any[]) =>
        mockUseFindFirstRegistrationSettings(...args),
    },
  }),
}));

// Mock ZenStack registration settings hook
const mockUseFindFirstRegistrationSettings = vi.fn();

// Mock next-auth signIn
const mockSignIn = vi.fn();
vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    signIn: (...args: any[]) => mockSignIn(...args),
  };
});

// Mock HelpPopover
vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

// Mock the browser side of WebAuthn (jsdom has none)
const mockBrowserSupportsWebAuthn = vi.fn();
const mockStartAuthentication = vi.fn();
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => mockBrowserSupportsWebAuthn(),
  startAuthentication: (...args: any[]) => mockStartAuthentication(...args),
}));

// Import after mocks
import Signin from "./page";

// Mock document.elementFromPoint which is used by input-otp library but not implemented in jsdom
if (typeof document.elementFromPoint !== "function") {
  Object.defineProperty(document, "elementFromPoint", {
    value: vi.fn().mockReturnValue(null),
    writable: true,
  });
}

describe("Signin Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset elementFromPoint mock
    (document.elementFromPoint as ReturnType<typeof vi.fn>)?.mockReturnValue?.(
      null
    );
    mockRouterPush.mockClear();
    mockBrowserSupportsWebAuthn.mockReturnValue(false);

    // Default: no SSO providers, finished loading
    mockUseFindManySsoProvider.mockReturnValue({
      data: [],
      isLoading: false,
    });

    // Default: self-registration enabled
    mockUseFindFirstRegistrationSettings.mockReturnValue({
      data: { allowOpenRegistration: true },
      isLoading: false,
    });

    // Mock fetch for admin-contact and session
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/admin-contact") {
        return Promise.resolve({
          json: () => Promise.resolve({ email: null }),
        });
      }
      if (url === "/api/auth/session") {
        return Promise.resolve({
          json: () => Promise.resolve({ user: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  async function waitForFormToRender() {
    // The component clears session cookies in a useEffect then sets sessionCleared=true
    // We need to let effects run so the form becomes visible
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("renders the sign-in form with email, password, and submit button", async () => {
    render(<Signin />);
    await waitForFormToRender();

    expect(screen.getByTestId("email-input")).toBeInTheDocument();
    expect(screen.getByTestId("password-input")).toBeInTheDocument();
    expect(screen.getByTestId("signin-button")).toBeInTheDocument();
  });

  it("shows a link to the signup page", async () => {
    render(<Signin />);
    await waitForFormToRender();

    const signupLink = screen.getByRole("link", {
      name: /signup|create|sign up|register/i,
    });
    expect(signupLink).toBeInTheDocument();
    expect(signupLink.getAttribute("href")).toContain("/signup");
  });

  it("hides the signup link when self-registration is disabled", async () => {
    mockUseFindFirstRegistrationSettings.mockReturnValue({
      data: { allowOpenRegistration: false },
      isLoading: false,
    });

    render(<Signin />);
    await waitForFormToRender();

    expect(
      screen.queryByRole("link", { name: /signup|create|sign up|register/i })
    ).not.toBeInTheDocument();
  });

  it("shows validation error when submitting with empty email", async () => {
    const user = userEvent.setup();
    render(<Signin />);
    await waitForFormToRender();

    const submitButton = screen.getByTestId("signin-button");
    await user.click(submitButton);

    await waitFor(() => {
      // Form validation should prevent signIn from being called
      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });

  it("shows error message on failed sign-in with invalid credentials", async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });

    render(<Signin />);
    await waitForFormToRender();

    await user.type(screen.getByTestId("email-input"), "test@example.com");
    await user.type(screen.getByTestId("password-input"), "wrongpassword");
    await user.click(screen.getByTestId("signin-button"));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith(
        "credentials",
        expect.objectContaining({
          email: "test@example.com",
          password: "wrongpassword",
          redirect: false,
        })
      );
    });

    await waitFor(() => {
      // An error message should be displayed (text-destructive container)
      const errorContainer = document.querySelector(".text-destructive");
      expect(errorContainer).toBeInTheDocument();
    });
  });

  it("shows the session-ended notice when arriving with error=SessionEnded", async () => {
    const navigation = await import("next/navigation");
    const spy = vi
      .spyOn(navigation, "useSearchParams")
      .mockReturnValue(new URLSearchParams("error=SessionEnded") as never);
    try {
      render(<Signin />);
      await waitForFormToRender();
      expect(
        await screen.findByText("auth.errors.sessionEnded")
      ).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it("shows 2FA dialog when sign-in returns 2FA_REQUIRED error", async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({
      ok: false,
      error: "2FA_REQUIRED:test-auth-token",
    });

    render(<Signin />);
    await waitForFormToRender();

    await user.type(screen.getByTestId("email-input"), "test@example.com");
    await user.type(screen.getByTestId("password-input"), "mypassword");
    await user.click(screen.getByTestId("signin-button"));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalled();
    });

    // 2FA dialog should appear — the InputOTP group should be rendered
    await waitFor(() => {
      // The 2FA dialog has an InputOTP group with slots
      const otpInputs = document.querySelectorAll("[data-input-otp]");
      // Or the dialog opens with a shield icon or title
      // Check for the OTP input container
      const otpGroup = document.querySelector("[data-input-otp-container]");
      expect(otpInputs.length > 0 || otpGroup !== null).toBe(true);
    });
  });

  it("shows loading state during sign-in submission", async () => {
    // Mock signIn to return a pending promise
    let resolveSignIn!: (value: any) => void;
    mockSignIn.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      })
    );

    const user = userEvent.setup();
    render(<Signin />);
    await waitForFormToRender();

    await user.type(screen.getByTestId("email-input"), "test@example.com");
    await user.type(screen.getByTestId("password-input"), "password123");

    // Start submission but don't wait for it
    const submitButton = screen.getByTestId("signin-button");
    await user.click(submitButton);

    // Button should be disabled during loading
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    // Resolve the sign-in
    await act(async () => {
      resolveSignIn({ ok: false, error: "CredentialsSignin" });
    });
  });

  function mockAdminContact(body: { enabled?: boolean; email: string | null }) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(url === "/api/admin-contact" ? body : {}),
        })
    );
  }

  it("links the trouble-signing-in line to the admin's email", async () => {
    mockAdminContact({ enabled: true, email: "admin@example.com" });

    render(<Signin />);
    await waitForFormToRender();

    const line = await screen.findByTestId("signin-admin-contact");
    expect(line.querySelector("a")).toHaveAttribute(
      "href",
      "mailto:admin@example.com"
    );
  });

  it("shows the trouble-signing-in line without a link when there is no admin email", async () => {
    render(<Signin />);
    await waitForFormToRender();

    const line = await screen.findByTestId("signin-admin-contact");
    expect(line.querySelector("a")).toBeNull();
  });

  it("omits the trouble-signing-in line when the admin contact is turned off", async () => {
    mockAdminContact({ enabled: false, email: null });

    render(<Signin />);
    await waitForFormToRender();

    expect(screen.getByTestId("signin-button")).toBeInTheDocument();
    expect(screen.queryByTestId("signin-admin-contact")).toBeNull();
  });

  it("sends an account that must confirm its address to the verification page", async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({ ok: false, error: "EMAIL_NOT_VERIFIED" });

    render(<Signin />);
    await waitForFormToRender();

    await user.type(screen.getByTestId("email-input"), "test@example.com");
    await user.type(screen.getByTestId("password-input"), "mypassword");
    await user.click(screen.getByTestId("signin-button"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith(
        "/verify-email?email=test%40example.com"
      );
    });
  });

  it("redirects to 2FA setup page when 2FA_SETUP_REQUIRED error is returned", async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({
      ok: false,
      error: "2FA_SETUP_REQUIRED:setup-token-123",
    });

    render(<Signin />);
    await waitForFormToRender();

    await user.type(screen.getByTestId("email-input"), "test@example.com");
    await user.type(screen.getByTestId("password-input"), "mypassword");
    await user.click(screen.getByTestId("signin-button"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith(
        expect.stringContaining("/auth/two-factor-setup")
      );
    });
  });

  describe("passkey sign-in", () => {
    const OPTIONS_URL = "/api/auth/passkey/authenticate/options";

    function stubOptions(response: Record<string, unknown>) {
      const base = global.fetch as ReturnType<typeof vi.fn>;
      const fallback = base.getMockImplementation() as (
        url: string,
        init?: RequestInit
      ) => unknown;
      base.mockImplementation((url: string, init?: RequestInit) =>
        url === OPTIONS_URL ? Promise.resolve(response) : fallback(url, init)
      );
    }

    beforeEach(() => {
      mockBrowserSupportsWebAuthn.mockReturnValue(true);
      mockUseFindFirstRegistrationSettings.mockReturnValue({
        data: { allowOpenRegistration: true, allowPasskeys: true },
        isSuccess: true,
      });
      stubOptions({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            enabled: true,
            options: { challenge: "challenge-1" },
            challengeToken: "token-1",
          }),
      });
      mockStartAuthentication.mockResolvedValue({ id: "credential-1" });
    });

    it("offers the button even when no SSO provider is configured", async () => {
      render(<Signin />);
      await waitForFormToRender();

      expect(screen.getByTestId("passkey-signin-button")).toBeInTheDocument();
    });

    it("does not show the button until the settings have loaded", async () => {
      mockUseFindFirstRegistrationSettings.mockReturnValue({
        data: undefined,
        isSuccess: false,
      });
      render(<Signin />);
      await waitForFormToRender();

      expect(
        screen.queryByTestId("passkey-signin-button")
      ).not.toBeInTheDocument();
    });

    it("hides the button when an administrator switched passkeys off", async () => {
      mockUseFindFirstRegistrationSettings.mockReturnValue({
        data: { allowOpenRegistration: true, allowPasskeys: false },
        isSuccess: true,
      });
      render(<Signin />);
      await waitForFormToRender();

      expect(
        screen.queryByTestId("passkey-signin-button")
      ).not.toBeInTheDocument();
    });

    it("hides the button in a browser without passkey support", async () => {
      mockBrowserSupportsWebAuthn.mockReturnValue(false);
      render(<Signin />);
      await waitForFormToRender();

      expect(
        screen.queryByTestId("passkey-signin-button")
      ).not.toBeInTheDocument();
    });

    it("hides the button while Force SSO is on", async () => {
      mockUseFindManySsoProvider.mockReturnValue({
        data: [
          {
            id: "google-1",
            name: "google",
            type: "GOOGLE",
            enabled: true,
            forceSso: true,
          },
        ],
        isLoading: false,
      });
      render(<Signin />);
      await waitForFormToRender();

      expect(
        screen.queryByTestId("passkey-signin-button")
      ).not.toBeInTheDocument();
    });

    it("signs in with the browser's answer and the echoed challenge token", async () => {
      const user = userEvent.setup();
      mockSignIn.mockResolvedValue({ ok: true, error: null });

      render(<Signin />);
      await waitForFormToRender();
      await user.click(screen.getByTestId("passkey-signin-button"));

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith("passkey", {
          redirect: false,
          response: JSON.stringify({ id: "credential-1" }),
          challengeToken: "token-1",
        });
      });
      expect(mockStartAuthentication).toHaveBeenCalledWith({
        optionsJSON: { challenge: "challenge-1" },
      });
      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith("/");
      });
    });

    it("stays quiet when the browser's prompt is dismissed", async () => {
      const user = userEvent.setup();
      const dismissed = new Error("The operation was cancelled");
      dismissed.name = "NotAllowedError";
      mockStartAuthentication.mockRejectedValue(dismissed);

      render(<Signin />);
      await waitForFormToRender();
      await user.click(screen.getByTestId("passkey-signin-button"));

      await waitFor(() => {
        expect(mockStartAuthentication).toHaveBeenCalled();
      });
      expect(mockSignIn).not.toHaveBeenCalled();
      expect(
        screen.queryByText("auth.signin.passkey.failed")
      ).not.toBeInTheDocument();
    });

    it("reports a passkey the server refuses", async () => {
      const user = userEvent.setup();
      mockSignIn.mockResolvedValue({ ok: false, error: "PASSKEY_FAILED" });

      render(<Signin />);
      await waitForFormToRender();
      await user.click(screen.getByTestId("passkey-signin-button"));

      // The shared test messages hold no passkey strings, so the key shows.
      expect(
        await screen.findByText("auth.signin.passkey.failed")
      ).toBeInTheDocument();
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("reports when the server says passkeys are unavailable", async () => {
      const user = userEvent.setup();
      stubOptions({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ enabled: false }),
      });

      render(<Signin />);
      await waitForFormToRender();
      await user.click(screen.getByTestId("passkey-signin-button"));

      expect(
        await screen.findByText("auth.signin.passkey.unavailable")
      ).toBeInTheDocument();
      expect(mockStartAuthentication).not.toHaveBeenCalled();
    });

    it("says so when the page is open on another address than the configured one", async () => {
      const user = userEvent.setup();
      stubOptions({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ enabled: false, reason: "address_mismatch" }),
      });

      render(<Signin />);
      await waitForFormToRender();
      await user.click(screen.getByTestId("passkey-signin-button"));

      expect(
        await screen.findByText("auth.signin.passkey.addressMismatch")
      ).toBeInTheDocument();
      expect(mockStartAuthentication).not.toHaveBeenCalled();
    });

    it("reports a rate limit on the challenge request", async () => {
      const user = userEvent.setup();
      stubOptions({ ok: false, status: 429, json: () => Promise.resolve({}) });

      render(<Signin />);
      await waitForFormToRender();
      await user.click(screen.getByTestId("passkey-signin-button"));

      expect(
        await screen.findByText("auth.signin.passkey.tooManyRequests")
      ).toBeInTheDocument();
      expect(mockStartAuthentication).not.toHaveBeenCalled();
    });
  });

  describe("requesting a magic link", () => {
    const REQUEST_URL = "/api/auth/passwordless/request";

    /** Answer the device-bound request; everything else keeps its default. */
    function answerRequestWith(answer: () => Promise<unknown>) {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (url: string) =>
          url === REQUEST_URL
            ? answer()
            : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      );
    }

    async function requestMagicLink() {
      const user = userEvent.setup();
      mockUseFindManySsoProvider.mockReturnValue({
        data: [
          {
            id: "magic",
            name: "Magic Link",
            type: "MAGIC_LINK",
            enabled: true,
            forceSso: false,
          },
        ],
        isLoading: false,
      });
      render(<Signin />);
      await waitForFormToRender();

      await user.click(
        screen.getByRole("button", { name: "auth.signin.sso.magicLink" })
      );
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByRole("textbox"), "user@example.com");
      await user.click(
        within(dialog).getByRole("button", {
          name: "auth.signin.magicLink.sendLink",
        })
      );
      return dialog;
    }

    function sentAPlainLink() {
      return mockSignIn.mock.calls.some(([provider]) => provider === "email");
    }

    it.each([
      [
        "refuses the request",
        () =>
          Promise.resolve({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ error: "Invalid CSRF token" }),
          }),
      ],
      [
        "fails",
        () =>
          Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({}),
          }),
      ],
      ["cannot be reached", () => Promise.reject(new Error("network down"))],
      [
        "answers without saying which kind of link it sent",
        () =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({}),
          }),
      ],
    ])(
      "does not send a plain link when the server %s",
      async (_label, answer) => {
        answerRequestWith(answer);

        const dialog = await requestMagicLink();

        expect(
          await within(dialog).findByText("auth.signin.magicLink.error")
        ).toBeInTheDocument();
        expect(sentAPlainLink()).toBe(false);
        expect(
          within(dialog).queryByText("auth.signin.magicLink.checkEmail")
        ).not.toBeInTheDocument();
      }
    );

    it("sends the plain link when the install has device-bound links turned off", async () => {
      answerRequestWith(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ enabled: false }),
        })
      );

      const dialog = await requestMagicLink();

      expect(
        await within(dialog).findByText("auth.signin.magicLink.checkEmail")
      ).toBeInTheDocument();
      expect(sentAPlainLink()).toBe(true);
    });

    it("sends no plain link when the device-bound request succeeds", async () => {
      answerRequestWith(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              enabled: true,
              pendingId: "pa_1",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }),
        })
      );

      const dialog = await requestMagicLink();

      expect(
        await within(dialog).findByText("auth.signin.magicLink.checkEmail")
      ).toBeInTheDocument();
      expect(sentAPlainLink()).toBe(false);
    });
  });
});
