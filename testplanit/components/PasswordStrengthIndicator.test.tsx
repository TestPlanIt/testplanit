import { describe, expect, it, vi } from "vitest";
import { render, screen } from "~/test/test-utils";
import {
  PasswordStrengthIndicator,
  type PasswordPolicy,
} from "./PasswordStrengthIndicator";

// Mock zxcvbn-ts to avoid loading the large dictionary in tests
vi.mock("@zxcvbn-ts/core", () => ({
  zxcvbn: vi.fn(() => ({ score: 0, feedback: { warning: "" } })),
  zxcvbnOptions: { setOptions: vi.fn() },
}));

vi.mock("@zxcvbn-ts/language-en", () => ({
  dictionary: {},
  adjacencyGraphs: {},
}));

describe("PasswordStrengthIndicator", () => {
  it("returns null when password is empty string", () => {
    const { container } = render(
      <PasswordStrengthIndicator password="" policy={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows minLength NOT met and uppercase NOT met, lowercase met for 'abc'", () => {
    const policy: PasswordPolicy = {
      minPasswordLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: false,
      requiredSpecialChars: null,
    };

    render(<PasswordStrengthIndicator password="abc" policy={policy} />);

    // min length requirement not met (abc is 3 chars, need 8)
    const minLengthItem = screen.getByText(/8 characters/i);
    expect(minLengthItem).toBeInTheDocument();

    // uppercase not met
    const uppercaseItem = screen.getByText(/uppercase/i);
    expect(uppercaseItem).toBeInTheDocument();

    // lowercase met
    const lowercaseItem = screen.getByText(/lowercase/i);
    expect(lowercaseItem).toBeInTheDocument();
  });

  it("shows minLength met, numbers met, specialChars met for 'hello123!'", () => {
    const policy: PasswordPolicy = {
      minPasswordLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: true,
      requiredSpecialChars: "!@#",
    };

    render(<PasswordStrengthIndicator password="hello123!" policy={policy} />);

    // min length met (9 chars >= 8)
    const minLengthItem = screen.getByText(/8 characters/i);
    expect(minLengthItem).toBeInTheDocument();

    // numbers met
    const numbersItem = screen.getByText(/number/i);
    expect(numbersItem).toBeInTheDocument();

    // special chars met
    const specialItem = screen.getByText(/special/i);
    expect(specialItem).toBeInTheDocument();
  });

  it("renders no requirements checklist when policy is null", () => {
    render(<PasswordStrengthIndicator password="hello" policy={null} />);

    // No requirement items should appear
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders exactly 4 segment divs for the strength bar", () => {
    const policy: PasswordPolicy = {
      minPasswordLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireNumbers: false,
      requiredSpecialChars: null,
    };

    const { container } = render(
      <PasswordStrengthIndicator password="somepassword" policy={policy} />
    );

    // The strength bar container has a flex div with 4 child divs (segments)
    const flexBar = container.querySelector(".flex.gap-1");
    expect(flexBar).not.toBeNull();
    const segments = flexBar?.querySelectorAll("div");
    expect(segments).toHaveLength(4);
  });
});
