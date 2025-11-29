import { test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AddAppConfigModal } from "./AddAppConfig";

// Mock the translation hook
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

// Mock the custom data hook
const mockMutateAsync = vi.fn();
vi.mock("~/lib/hooks/app-config", () => ({
  useCreateAppConfig: () => ({ mutateAsync: mockMutateAsync }),
}));

// Helper to wrap component in QueryClientProvider
const queryClient = new QueryClient();
const renderWithProvider = (ui: React.ReactElement) => {
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  // Reset mocks before each test
  mockMutateAsync.mockClear();
});

test("renders the add config button", () => {
  renderWithProvider(<AddAppConfigModal />);
  expect(
    screen.getByRole("button", { name: "admin.appConfig.addConfig" })
  ).toBeInTheDocument();
});

test("opens modal when add button is clicked", async () => {
  const { user } = renderWithProvider(<AddAppConfigModal />);
  const addButton = screen.getByRole("button", {
    name: "admin.appConfig.addConfig",
  });
  await user.click(addButton);

  // Check if the dialog title is visible
  expect(
    screen.getByRole("heading", { name: "admin.appConfig.addConfig" })
  ).toBeVisible();
  // Check for form elements
  expect(
    screen.getByLabelText("common.fields.key", { selector: "input" })
  ).toBeVisible();
  expect(
    screen.getByLabelText("common.fields.value", { selector: "textarea" })
  ).toBeVisible();
});

test("shows validation errors for empty fields on submit", async () => {
  const { user } = renderWithProvider(<AddAppConfigModal />);
  const addButton = screen.getByRole("button", {
    name: "admin.appConfig.addConfig",
  });
  await user.click(addButton);

  // Find the submit button within the modal (use the mock translation)
  const submitButton = screen.getByRole("button", {
    name: "common.actions.submit",
  });
  await user.click(submitButton);

  // Check for validation messages (using mock translations)
  expect(
    await screen.findByText("admin.appConfig.errors.keyRequired")
  ).toBeVisible();
  expect(
    await screen.findByText("admin.appConfig.errors.valueRequired")
  ).toBeVisible();
  // Ensure mutation was NOT called
  expect(mockMutateAsync).not.toHaveBeenCalled();
});

test("shows validation error for invalid JSON in value field", async () => {
  const { user } = renderWithProvider(<AddAppConfigModal />);
  const addButton = screen.getByRole("button", {
    name: "admin.appConfig.addConfig",
  });
  await user.click(addButton);

  const keyInput = screen.getByLabelText("common.fields.key", {
    selector: "input",
  });
  const valueInput = screen.getByLabelText("common.fields.value", {
    selector: "textarea",
  });
  const submitButton = screen.getByRole("button", {
    name: "common.actions.submit",
  });

  // Fill with valid key but invalid JSON value
  await user.type(keyInput, "test-key");
  await user.type(valueInput, "not valid json");
  await user.click(submitButton);

  // Check for the specific JSON validation error
  expect(
    await screen.findByText("admin.appConfig.errors.invalidJson")
  ).toBeVisible();
  // Ensure mutation was NOT called
  expect(mockMutateAsync).not.toHaveBeenCalled();
});

test("calls mutation with parsed data on successful submission", async () => {
  // Make mockMutateAsync resolve successfully
  mockMutateAsync.mockResolvedValue({});

  const { user } = renderWithProvider(<AddAppConfigModal />);
  const addButton = screen.getByRole("button", {
    name: "admin.appConfig.addConfig",
  });
  await user.click(addButton);

  const keyInput = screen.getByLabelText("common.fields.key", {
    selector: "input",
  });
  const valueInput = screen.getByLabelText("common.fields.value", {
    selector: "textarea",
  });
  const submitButton = screen.getByRole("button", {
    name: "common.actions.submit",
  });

  const testKey = "new-config-key";
  const testValue = { setting: true, level: 5 };
  const testValueString = JSON.stringify(testValue);

  await user.type(keyInput, testKey);
  // Focus the textarea first
  valueInput.focus();
  // Paste the JSON string into the focused element
  await user.paste(testValueString);
  await user.click(submitButton);

  // Check that the mutation function was called
  expect(mockMutateAsync).toHaveBeenCalledTimes(1);

  // Check that the mutation function was called with the correct, *parsed* arguments
  expect(mockMutateAsync).toHaveBeenCalledWith({
    data: {
      key: testKey,
      value: testValue, // Expect the JS object, not the string
    },
  });

  // Optional: Check if the modal closes after successful submission
  // This depends on how `setOpen(false)` interacts with the testing environment.
  // await waitForElementToBeRemoved(() => screen.queryByRole("heading", { name: "admin.appConfig.addConfig" }));
});

test("closes modal when cancel button is clicked", async () => {
  const { user } = renderWithProvider(<AddAppConfigModal />);
  const addButton = screen.getByRole("button", {
    name: "admin.appConfig.addConfig",
  });
  await user.click(addButton);

  // Modal should be open
  expect(
    screen.getByRole("heading", { name: "admin.appConfig.addConfig" })
  ).toBeVisible();

  const cancelButton = screen.getByRole("button", {
    name: "common.actions.cancel",
  });
  await user.click(cancelButton);

  // Modal should be closed - check that the heading is gone
  // Use queryByRole which returns null if not found, instead of throwing
  expect(
    screen.queryByRole("heading", { name: "admin.appConfig.addConfig" })
  ).not.toBeInTheDocument();

  // Ensure mutation was NOT called
  expect(mockMutateAsync).not.toHaveBeenCalled();
});
