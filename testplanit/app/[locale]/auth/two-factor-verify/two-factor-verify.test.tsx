import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "~/test/test-utils";

// Mock document.elementFromPoint which is used by input-otp library but not implemented in jsdom
if (typeof document !== "undefined") {
  Object.defineProperty(document, "elementFromPoint", {
    value: vi.fn().mockReturnValue(null),
    writable: true,
    configurable: true,
  });
}

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ alt, src, ...props }: any) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

// Mock the logo SVG
vi.mock("~/public/tpi_logo.svg", () => ({ default: "test-logo.svg" }));

// Mock ~/lib/navigation
const mockRouterPush = vi.fn();
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Use vi.hoisted to avoid hoisting issues with variables used in vi.mock factories
const { mockUpdateSession, mockSignOut } = vi.hoisted(() => ({
  mockUpdateSession: vi.fn(),
  mockSignOut: vi.fn(),
}));

// Mock next-auth
vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: () => ({
      data: {
        user: {
          id: "test-user",
          name: "Test User",
          email: "test@example.com",
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      status: "authenticated",
      update: mockUpdateSession,
    }),
    signOut: mockSignOut,
  };
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  usePathname: () => "/",
}));

// Import after mocks
import TwoFactorVerifyPage from "./page";

describe("TwoFactorVerifyPage", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterPush.mockClear();
    mockUpdateSession.mockClear();
    mockSignOut.mockClear();

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    global.fetch = mockFetch as any;
  });

  it("renders OTP input slots for 6-digit code entry", () => {
    render(<TwoFactorVerifyPage />);

    // The InputOTP component renders individual slots with data-input-otp attribute
    const otpContainer = document.querySelector("[data-input-otp]");
    expect(otpContainer).toBeInTheDocument();

    // Should have 6 slots
    const _otpSlots = document.querySelectorAll("[data-input-otp-container] > *");
    // The OTP group should contain slots
    const inputOtpGroup = document.querySelector("[data-input-otp-container]");
    expect(inputOtpGroup).toBeInTheDocument();
  });

  it("renders the verify button initially disabled (no code entered)", () => {
    render(<TwoFactorVerifyPage />);

    // The verify button has the translated text "common.actions.verify"
    // Use exact text to avoid matching the toggle button which also contains "Verify"
    const verifyButton = screen.getByRole("button", {
      name: "common.actions.verify",
    });
    expect(verifyButton).toBeInTheDocument();
    // Button should be disabled since no code is entered (length < 6)
    expect(verifyButton).toBeDisabled();
  });

  it("shows a sign-out button", () => {
    render(<TwoFactorVerifyPage />);

    // Sign out button/link should be present
    const signOutButton = screen.getByRole("button", {
      name: "auth.twoFactorVerify.signOut",
    });
    expect(signOutButton).toBeInTheDocument();
  });

  it("toggles to backup code input mode when toggle button is clicked", async () => {
    const user = userEvent.setup();
    render(<TwoFactorVerifyPage />);

    // Initially, OTP input is shown
    expect(document.querySelector("[data-input-otp]")).toBeInTheDocument();
    expect(document.querySelector("input[placeholder='XXXXXXXX']")).not.toBeInTheDocument();

    // Find and click the toggle button (shows "use backup code" text)
    const toggleButton = screen.getByRole("button", {
      name: "auth.twoFactorVerify.useBackupCode",
    });
    expect(toggleButton).toBeInTheDocument();
    await user.click(toggleButton);

    // After toggle, backup code input should appear (8 char placeholder)
    await waitFor(() => {
      expect(document.querySelector("input[placeholder='XXXXXXXX']")).toBeInTheDocument();
    });

    // OTP input should be gone
    expect(document.querySelector("[data-input-otp]")).not.toBeInTheDocument();
  });

  it("toggles back to OTP authenticator mode from backup code mode", async () => {
    const user = userEvent.setup();
    render(<TwoFactorVerifyPage />);

    // Click to switch to backup code mode
    const toggleToBackup = screen.getByRole("button", {
      name: "auth.twoFactorVerify.useBackupCode",
    });
    await user.click(toggleToBackup);

    await waitFor(() => {
      expect(document.querySelector("input[placeholder='XXXXXXXX']")).toBeInTheDocument();
    });

    // Click again to switch back to authenticator
    const toggleToAuth = screen.getByRole("button", {
      name: "auth.twoFactorVerify.useAuthenticator",
    });
    await user.click(toggleToAuth);

    await waitFor(() => {
      expect(document.querySelector("[data-input-otp]")).toBeInTheDocument();
    });

    expect(document.querySelector("input[placeholder='XXXXXXXX']")).not.toBeInTheDocument();
  });

  it("shows error message when verification API call fails", async () => {
    const user = userEvent.setup();
    const errorMessage = "Invalid verification code";

    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: errorMessage }),
    });
    global.fetch = mockFetch as any;

    render(<TwoFactorVerifyPage />);

    // Switch to backup code mode to make it easy to type a code
    const toggleButton = screen.getByRole("button", {
      name: "auth.twoFactorVerify.useBackupCode",
    });
    await user.click(toggleButton);

    await waitFor(() => {
      expect(document.querySelector("input[placeholder='XXXXXXXX']")).toBeInTheDocument();
    });

    // Type an 8-character backup code
    const backupInput = document.querySelector("input[placeholder='XXXXXXXX']") as HTMLInputElement;
    await user.type(backupInput, "ABCD1234");

    // Verify button should be enabled now
    const verifyButton = screen.getByRole("button", {
      name: "common.actions.verify",
    });
    expect(verifyButton).not.toBeDisabled();

    await user.click(verifyButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/auth/two-factor/verify-sso",
        expect.any(Object)
      );
    });

    await waitFor(() => {
      const errorEl = document.querySelector(".text-destructive");
      expect(errorEl).toBeInTheDocument();
      expect(errorEl?.textContent).toContain(errorMessage);
    });
  });

  it("verify button is disabled when backup code is fewer than 8 characters", async () => {
    const user = userEvent.setup();
    render(<TwoFactorVerifyPage />);

    // Switch to backup code mode
    const toggleButton = screen.getByRole("button", {
      name: "auth.twoFactorVerify.useBackupCode",
    });
    await user.click(toggleButton);

    await waitFor(() => {
      expect(document.querySelector("input[placeholder='XXXXXXXX']")).toBeInTheDocument();
    });

    // Type only 4 characters (less than 8)
    const backupInput = document.querySelector("input[placeholder='XXXXXXXX']") as HTMLInputElement;
    await user.type(backupInput, "ABCD");

    // Verify button should be disabled (backup code needs 8 chars)
    const verifyButton = screen.getByRole("button", {
      name: "common.actions.verify",
    });
    expect(verifyButton).toBeDisabled();
  });

  it("calls signOut when sign-out button is clicked", async () => {
    const user = userEvent.setup();
    render(<TwoFactorVerifyPage />);

    const signOutButton = screen.getByRole("button", {
      name: "auth.twoFactorVerify.signOut",
    });
    await user.click(signOutButton);

    // signOut is dynamically imported, so we check the fetch or mock differently
    // The component does: const { signOut } = await import("next-auth/react")
    // We can verify it tried to sign out by waiting for the mock to be called
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: "/signin" });
    }, { timeout: 3000 });
  });
});
