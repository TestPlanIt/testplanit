import { act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "~/test/test-utils";

// Mock @prisma/client
vi.mock("@prisma/client", () => ({
  SsoProviderType: {
    GOOGLE: "GOOGLE",
    APPLE: "APPLE",
    MICROSOFT: "MICROSOFT",
    SAML: "SAML",
    MAGIC_LINK: "MAGIC_LINK",
  },
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
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

// Mock ZenStack hooks
const mockUseFindManySsoProvider = vi.fn();
const mockUseFindFirstRegistrationSettings = vi.fn();
vi.mock("~/lib/hooks", () => ({
  useFindManySsoProvider: (...args: any[]) =>
    mockUseFindManySsoProvider(...args),
  useFindFirstRegistrationSettings: (...args: any[]) =>
    mockUseFindFirstRegistrationSettings(...args),
}));

// Mock server actions
vi.mock("~/app/actions/auth", () => ({
  isEmailDomainAllowed: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/app/actions/notifications", () => ({
  createUserRegistrationNotification: vi.fn().mockResolvedValue(undefined),
}));

// Mock EmailVerifications
vi.mock("@/components/EmailVerifications", () => ({
  generateEmailVerificationToken: vi.fn().mockResolvedValue("test-token"),
  resendVerificationEmail: vi.fn().mockResolvedValue(undefined),
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

// Mock next/navigation notFound
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  usePathname: () => "/",
  notFound: vi.fn(),
}));

// Mock HelpPopover
vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

// Import after mocks
import Signup from "./page";

describe("Signup Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterPush.mockClear();

    // Default: no force SSO, loaded
    mockUseFindManySsoProvider.mockReturnValue({
      data: [],
      isLoading: false,
    });
    mockUseFindFirstRegistrationSettings.mockReturnValue({
      data: {
        requireEmailVerification: false,
        defaultAccess: "NONE",
      },
    });

    mockSignIn.mockResolvedValue({ ok: true, error: null });
  });

  async function waitForFormToRender() {
    // The component clears session cookies in a useEffect then sets sessionCleared=true
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  function setupFetchMock(options?: {
    status?: number;
    response?: object;
  }) {
    const status = options?.status ?? 201;
    const response = options?.response ?? {
      data: { id: "user-123", name: "Test User", email: "test@example.com" },
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response),
    });
  }

  it("renders sign-up form with name, email, password, confirmPassword fields and submit button", async () => {
    setupFetchMock();
    render(<Signup />);
    await waitForFormToRender();

    // Fields are rendered via react-hook-form FormField without explicit data-testid
    // They are labeled with translation keys
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThanOrEqual(2);

    const passwordInputs = document.querySelectorAll("input[type='password']");
    expect(passwordInputs.length).toBeGreaterThanOrEqual(2);

    // Submit button
    expect(screen.getByRole("button", { name: /sign up|common\.actions\.signUp/i })).toBeInTheDocument();
  });

  it("shows a link back to the signin page", async () => {
    setupFetchMock();
    render(<Signup />);
    await waitForFormToRender();

    const signinLink = document.querySelector("a[href*='/signin']");
    expect(signinLink).toBeInTheDocument();
  });

  it("shows validation error when passwords do not match", async () => {
    const user = userEvent.setup();
    setupFetchMock();
    render(<Signup />);
    await waitForFormToRender();

    const inputs = screen.getAllByRole("textbox");
    // First textbox is name, second is email
    await user.type(inputs[0], "John Doe");
    await user.type(inputs[1], "john@example.com");

    const passwordInputs = document.querySelectorAll("input[type='password']");
    await user.type(passwordInputs[0] as HTMLElement, "password123");
    await user.type(passwordInputs[1] as HTMLElement, "differentpass");

    const submitButton = screen.getByRole("button", { name: /sign up|common\.actions\.signUp/i });
    await user.click(submitButton);

    await waitFor(() => {
      // Validation error for password mismatch via FormMessage
      const formMessages = document.querySelectorAll("[class*='text-destructive'], .text-destructive");
      expect(formMessages.length).toBeGreaterThan(0);
    });
  });

  it("shows validation error for name that is too short (< 2 chars)", async () => {
    const user = userEvent.setup();
    setupFetchMock();
    render(<Signup />);
    await waitForFormToRender();

    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[0], "J"); // Single char name
    await user.type(inputs[1], "john@example.com");

    const passwordInputs = document.querySelectorAll("input[type='password']");
    await user.type(passwordInputs[0] as HTMLElement, "password123");
    await user.type(passwordInputs[1] as HTMLElement, "password123");

    const submitButton = screen.getByRole("button", { name: /sign up|common\.actions\.signUp/i });
    await user.click(submitButton);

    await waitFor(() => {
      // Should not call the API since validation fails
      expect(global.fetch).not.toHaveBeenCalledWith(
        "/api/auth/signup",
        expect.any(Object)
      );
    });
  });

  it("shows error for duplicate email when API returns already exists error", async () => {
    const user = userEvent.setup();
    // Mock the signup API to return 400 with "already exists"
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "User with this email already exists" }),
    });

    render(<Signup />);
    await waitForFormToRender();

    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[0], "John Doe");
    await user.type(inputs[1], "existing@example.com");

    const passwordInputs = document.querySelectorAll("input[type='password']");
    await user.type(passwordInputs[0] as HTMLElement, "password123");
    await user.type(passwordInputs[1] as HTMLElement, "password123");

    const submitButton = screen.getByRole("button", { name: /sign up|common\.actions\.signUp/i });
    await user.click(submitButton);

    await waitFor(() => {
      // API is called
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/signup",
        expect.any(Object)
      );
    });

    await waitFor(() => {
      // Error message about duplicate email should appear
      const errorEl = document.querySelector(".text-destructive");
      expect(errorEl).toBeInTheDocument();
    });
  });

  it("redirects to home on successful signup", async () => {
    const user = userEvent.setup();
    setupFetchMock({ status: 201 });
    mockSignIn.mockResolvedValue({ ok: true, error: null });

    render(<Signup />);
    await waitForFormToRender();

    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[0], "John Doe");
    await user.type(inputs[1], "john@example.com");

    const passwordInputs = document.querySelectorAll("input[type='password']");
    await user.type(passwordInputs[0] as HTMLElement, "password123");
    await user.type(passwordInputs[1] as HTMLElement, "password123");

    const submitButton = screen.getByRole("button", { name: /sign up|common\.actions\.signUp/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/");
    });
  });
});
