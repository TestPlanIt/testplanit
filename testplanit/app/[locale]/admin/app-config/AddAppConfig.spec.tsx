import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { AddAppConfig } from "./AddAppConfig";

// Mock the translation hook
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock the custom data hook
const mockMutateAsync = vi.fn();
vi.mock("~/lib/hooks/app-config", () => ({
  useCreateAppConfig: () => ({ mutateAsync: mockMutateAsync }),
}));

// Helper to wrap component in QueryClientProvider with open=true so the
// dialog renders. Each test gets its own onClose mock.
const queryClient = new QueryClient();
const renderOpen = () => {
  const onClose = vi.fn();
  return {
    user: userEvent.setup(),
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AddAppConfig open={true} onClose={onClose} />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  // Reset mocks before each test
  mockMutateAsync.mockClear();
});

test("renders the dialog with form fields when open", () => {
  renderOpen();
  // Dialog title is visible
  expect(
    screen.getByRole("heading", { name: "admin.appConfig.addConfig" })
  ).toBeVisible();
  // Form elements are visible
  expect(
    screen.getByLabelText("common.fields.key", { selector: "input" })
  ).toBeVisible();
  expect(
    screen.getByLabelText("common.fields.value", { selector: "textarea" })
  ).toBeVisible();
});

test("shows validation errors for empty fields on submit", async () => {
  const { user } = renderOpen();

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
    await screen.findByText("common.errors.valueRequired")
  ).toBeVisible();
  // Ensure mutation was NOT called
  expect(mockMutateAsync).not.toHaveBeenCalled();
});

test("shows validation error for invalid JSON in value field", async () => {
  const { user } = renderOpen();

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

test("calls mutation with parsed data and onClose on successful submission", async () => {
  // Make mockMutateAsync resolve successfully
  mockMutateAsync.mockResolvedValue({});

  const { user, onClose } = renderOpen();

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

  // After successful submission, onClose should be called (so the parent
  // can unmount this component).
  expect(onClose).toHaveBeenCalled();
});

test("calls onClose when cancel button is clicked", async () => {
  const { user, onClose } = renderOpen();

  const cancelButton = screen.getByRole("button", {
    name: "common.cancel",
  });
  await user.click(cancelButton);

  // Parent will unmount the component based on this callback.
  expect(onClose).toHaveBeenCalled();
  // Ensure mutation was NOT called
  expect(mockMutateAsync).not.toHaveBeenCalled();
});
