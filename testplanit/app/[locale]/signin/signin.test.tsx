import { act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "~/test/test-utils";

// Mock @prisma/client (SsoProviderType enum)
vi.mock("@prisma/client", () => ({
  SsoProviderType: {
    GOOGLE: "GOOGLE",
    APPLE: "APPLE",
    MICROSOFT: "MICROSOFT",
    SAML: "SAML",
    MAGIC_LINK: "MAGIC_LINK",
  },
}));

// Mock simple-icons
vi.mock("simple-icons", () => ({
  siGoogle: { path: "M1 1" },
  siApple: { path: "M2 2" },
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
}));

// Mock the logo SVG
vi.mock("~/public/tpi_logo.svg", () => ({ default: "test-logo.svg" }));

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
vi.mock("~/lib/hooks/sso-provider", () => ({
  useFindManySsoProvider: (...args: any[]) => mockUseFindManySsoProvider(...args),
}));

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
    (document.elementFromPoint as ReturnType<typeof vi.fn>)?.mockReturnValue?.(null);
    mockRouterPush.mockClear();

    // Default: no SSO providers, finished loading
    mockUseFindManySsoProvider.mockReturnValue({
      data: [],
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

    const signupLink = screen.getByRole("link", { name: /signup|create|sign up|register/i });
    expect(signupLink).toBeInTheDocument();
    expect(signupLink.getAttribute("href")).toContain("/signup");
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
      expect(mockSignIn).toHaveBeenCalledWith("credentials", expect.objectContaining({
        email: "test@example.com",
        password: "wrongpassword",
        redirect: false,
      }));
    });

    await waitFor(() => {
      // An error message should be displayed (text-destructive container)
      const errorContainer = document.querySelector(".text-destructive");
      expect(errorContainer).toBeInTheDocument();
    });
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
});
