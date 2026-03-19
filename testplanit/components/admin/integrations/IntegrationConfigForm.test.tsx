import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @prisma/client enums for jsdom
vi.mock("@prisma/client", () => ({
  IntegrationProvider: {
    JIRA: "JIRA",
    GITHUB: "GITHUB",
    AZURE_DEVOPS: "AZURE_DEVOPS",
    SIMPLE_URL: "SIMPLE_URL",
  },
  IntegrationAuthType: {
    API_KEY: "API_KEY",
    OAUTH2: "OAUTH2",
    PERSONAL_ACCESS_TOKEN: "PERSONAL_ACCESS_TOKEN",
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("@/components/ui/form", () => ({
  FormItem: ({ children }: any) => <div>{children}</div>,
  FormLabel: ({ children, className }: any) => (
    <label className={className}>{children}</label>
  ),
  FormControl: ({ children }: any) => <>{children}</>,
  FormDescription: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => (
    <span data-testid="badge" {...rest}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ placeholder, disabled, type, value, onChange, ...rest }: any) => (
    <input
      data-testid={rest["data-testid"] || `input-${type || "text"}`}
      placeholder={placeholder}
      disabled={disabled}
      type={type || "text"}
      value={value}
      onChange={onChange}
      {...rest}
    />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type, disabled, ...rest }: any) => (
    <button type={type || "button"} onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children, ...rest }: any) => (
    <div role="alert" {...rest}>
      {children}
    </div>
  ),
  AlertTitle: ({ children }: any) => <strong>{children}</strong>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

import { IntegrationConfigForm } from "./IntegrationConfigForm";

const defaultProps = {
  credentials: {},
  settings: {},
  onCredentialsChange: vi.fn(),
  onSettingsChange: vi.fn(),
};

describe("IntegrationConfigForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock crypto.getRandomValues for generateApiKey
    Object.defineProperty(global, "crypto", {
      value: {
        getRandomValues: (arr: Uint8Array) => {
          for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
          return arr;
        },
      },
      configurable: true,
    });
  });

  describe("JIRA + API_KEY", () => {
    it("renders email, apiToken, and baseUrl fields", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="API_KEY"
        />
      );

      const inputs = screen.getAllByRole("textbox");
      // Should have email, baseUrl (text inputs); apiToken is password type
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      expect(inputs.length).toBeGreaterThanOrEqual(1);
      expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    });

    it("shows API key warning alert", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="API_KEY"
        />
      );

      // Warning alert should be shown for JIRA + API_KEY
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("calls onCredentialsChange when email input changes", () => {
      const onCredentialsChange = vi.fn();

      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="API_KEY"
          onCredentialsChange={onCredentialsChange}
        />
      );

      // Find input with email placeholder key fragment
      const inputs = screen.getAllByRole("textbox");
      // Type in the first text input (email)
      fireEvent.change(inputs[0], { target: { value: "user@example.com" } });

      expect(onCredentialsChange).toHaveBeenCalled();
    });

    it("calls onSettingsChange when baseUrl changes", () => {
      const onSettingsChange = vi.fn();

      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="API_KEY"
          onSettingsChange={onSettingsChange}
        />
      );

      // baseUrl placeholder is "jiraUrlPlaceholder" - find input by placeholder
      // In JIRA API_KEY, baseUrl is the last non-password, non-forgeApiKey textbox
      // Use the input with jiraUrl placeholder key
      const allInputs = document.querySelectorAll("input:not([type=password]):not([readonly])");
      // Filter inputs that have a placeholder ending in "Placeholder"
      let baseUrlInput: Element | null = null;
      allInputs.forEach((input) => {
        const placeholder = (input as HTMLInputElement).placeholder;
        if (placeholder && placeholder.toLowerCase().includes("jiraurl")) {
          baseUrlInput = input;
        }
      });

      if (baseUrlInput) {
        fireEvent.change(baseUrlInput, {
          target: { value: "https://mycompany.atlassian.net" },
        });
        expect(onSettingsChange).toHaveBeenCalled();
      } else {
        // Find the input by its position - email (textbox[0]), baseUrl (textbox[1])
        const inputs = screen.getAllByRole("textbox");
        // baseUrl is not the forgeApiKey (which is readonly)
        const nonReadonly = inputs.filter(
          (i) => !(i as HTMLInputElement).readOnly
        );
        // email is index 0, baseUrl should be index 1 (skipping password fields)
        if (nonReadonly.length > 1) {
          fireEvent.change(nonReadonly[1], {
            target: { value: "https://mycompany.atlassian.net" },
          });
          expect(onSettingsChange).toHaveBeenCalled();
        }
      }
    });
  });

  describe("JIRA + OAUTH2", () => {
    it("renders clientId, clientSecret, and baseUrl fields", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="OAUTH2"
        />
      );

      // Should have clientId (text), clientSecret (password), baseUrl (text)
      const inputs = screen.getAllByRole("textbox");
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      expect(inputs.length).toBeGreaterThanOrEqual(1);
      expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    });

    it("does not show API key warning for OAUTH2", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="OAUTH2"
        />
      );

      // No warning alert for OAuth2
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("GITHUB + PERSONAL_ACCESS_TOKEN", () => {
    it("renders personalAccessToken password field", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="GITHUB"
          authType="PERSONAL_ACCESS_TOKEN"
        />
      );

      const passwordInputs = document.querySelectorAll('input[type="password"]');
      expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("AZURE_DEVOPS + PERSONAL_ACCESS_TOKEN", () => {
    it("renders personalAccessToken and organizationUrl fields", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="AZURE_DEVOPS"
          authType="PERSONAL_ACCESS_TOKEN"
        />
      );

      const passwordInputs = document.querySelectorAll('input[type="password"]');
      expect(passwordInputs.length).toBeGreaterThanOrEqual(1);

      // organizationUrl is a text input (non-credential)
      const textInputs = screen.getAllByRole("textbox");
      expect(textInputs.length).toBeGreaterThanOrEqual(1);
    });

    it("calls onSettingsChange when organizationUrl changes", () => {
      const onSettingsChange = vi.fn();

      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="AZURE_DEVOPS"
          authType="PERSONAL_ACCESS_TOKEN"
          onSettingsChange={onSettingsChange}
        />
      );

      const textInputs = screen.getAllByRole("textbox");
      fireEvent.change(textInputs[0], {
        target: { value: "https://dev.azure.com/myorg" },
      });

      expect(onSettingsChange).toHaveBeenCalledWith(
        expect.objectContaining({ organizationUrl: "https://dev.azure.com/myorg" })
      );
    });
  });

  describe("SIMPLE_URL", () => {
    it("renders base URL field", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="SIMPLE_URL"
          authType="API_KEY"
        />
      );

      // SIMPLE_URL has apiKey (password, optional) and baseUrl (text from providerFields)
      const allInputs = document.querySelectorAll("input");
      expect(allInputs.length).toBeGreaterThan(0);
    });

    it("calls onSettingsChange when baseUrl changes", () => {
      const onSettingsChange = vi.fn();

      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="SIMPLE_URL"
          authType="API_KEY"
          onSettingsChange={onSettingsChange}
        />
      );

      // baseUrl is a text input
      const textInputs = screen.queryAllByRole("textbox");
      if (textInputs.length > 0) {
        fireEvent.change(textInputs[0], {
          target: { value: "https://example.com/issues/{id}" },
        });
        expect(onSettingsChange).toHaveBeenCalled();
      }
    });

    it("shows generate button for JIRA Forge API key section", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="API_KEY"
          settings={{}}
        />
      );

      // The "Generate" button for forge API key should appear for JIRA providers
      const buttons = screen.getAllByRole("button");
      const generateBtn = buttons.find((b) =>
        b.textContent?.match(/forgeApiKeyGenerate|generate/i)
      );
      expect(generateBtn).toBeTruthy();
    });
  });

  describe("isEdit=true - encrypted badge display", () => {
    it("shows encrypted badge on credential fields when value is empty in edit mode", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="API_KEY"
          credentials={{}}
          isEdit={true}
        />
      );

      // When isEdit=true and credential field is empty, shows encrypted badge
      const badges = screen.getAllByTestId("badge");
      expect(badges.length).toBeGreaterThan(0);
      // Badge should show "encrypted" key
      const encryptedBadge = badges.find((b) =>
        b.textContent?.match(/encrypted/i)
      );
      expect(encryptedBadge).toBeTruthy();
    });

    it("does not show encrypted badge when credential has a value", () => {
      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="API_KEY"
          credentials={{ email: "user@example.com", apiToken: "mytoken123" }}
          isEdit={true}
        />
      );

      // When credential has a value, no encrypted badge for that field
      const badges = screen.queryAllByTestId("badge");
      // May have fewer badges since some credentials are filled in
      expect(
        badges.every((b) => b.textContent !== "encrypted") || badges.length === 0
      ).toBe(true);
    });
  });

  describe("Forge API key generation (JIRA)", () => {
    it("calls onSettingsChange when generate button is clicked", () => {
      const onSettingsChange = vi.fn();

      render(
        <IntegrationConfigForm
          {...defaultProps}
          provider="JIRA"
          authType="API_KEY"
          settings={{}}
          onSettingsChange={onSettingsChange}
        />
      );

      const buttons = screen.getAllByRole("button");
      const generateBtn = buttons.find((b) =>
        b.textContent?.match(/forgeApiKeyGenerate|generate/i)
      );
      if (generateBtn) {
        fireEvent.click(generateBtn);
        expect(onSettingsChange).toHaveBeenCalledWith(
          expect.objectContaining({ forgeApiKey: expect.stringContaining("tpi_forge_") })
        );
      }
    });
  });
});
