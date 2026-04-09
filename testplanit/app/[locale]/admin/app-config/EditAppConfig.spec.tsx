import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { EditAppConfig } from "./EditAppConfig";

// Mock the translation hook
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

// Mock the update hook
const mockUpdateMutateAsync = vi.fn();
vi.mock("~/lib/hooks/app-config", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/lib/hooks/app-config")>();
  return {
    ...original, // Keep other exports if they exist
    useUpdateAppConfig: () => ({ mutateAsync: mockUpdateMutateAsync }),
  };
});

// Sample config data for testing
const sampleConfig = {
  key: "sample_key",
  value: { initial: "data", count: 1 },
};

// Helper to wrap component in QueryClientProvider with open=true so the
// dialog renders. EditAppConfig is now a pure form component that takes
// { config, open, onClose } props.
const queryClient = new QueryClient();
const renderOpen = (configProp = sampleConfig) => {
  const onClose = vi.fn();
  return {
    user: userEvent.setup(),
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <EditAppConfig config={configProp} open={true} onClose={onClose} />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  // Reset mocks before each test
  mockUpdateMutateAsync.mockClear();
});

test("renders dialog with initial data", () => {
  renderOpen();

  // Dialog title is visible
  expect(
    screen.getByRole("heading", { name: "admin.appConfig.editConfig" })
  ).toBeVisible();
  // Key is displayed (using mock translation)
  expect(screen.getByText("common.fields.configKeys.sample_key")).toBeVisible();
  // Value textarea has the correct initial stringified JSON
  expect(
    screen.getByLabelText("common.fields.value", { selector: "textarea" })
  ).toHaveValue(JSON.stringify(sampleConfig.value, null, 2));
});

test("shows validation error for invalid JSON", async () => {
  const { user } = renderOpen();

  const valueInput = screen.getByLabelText("common.fields.value", {
    selector: "textarea",
  });
  const submitButton = screen.getByRole("button", {
    name: "common.actions.submit",
  });

  // Clear existing value and type invalid JSON
  await user.clear(valueInput);
  // Focus and paste to handle the special '{' character correctly
  valueInput.focus();
  await user.paste("this is not valid json{");
  await user.click(submitButton);

  // Check for the specific JSON validation error
  expect(
    await screen.findByText("admin.appConfig.errors.invalidJson")
  ).toBeVisible();
  // Ensure mutation was NOT called
  expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
});

test("calls update mutation with parsed data and onClose on successful submission", async () => {
  mockUpdateMutateAsync.mockResolvedValue({});
  const { user, onClose } = renderOpen();

  const valueInput = screen.getByLabelText("common.fields.value", {
    selector: "textarea",
  });
  const submitButton = screen.getByRole("button", {
    name: "common.actions.submit",
  });

  const updatedValue = { updated: true, count: 2 };
  const updatedValueString = JSON.stringify(updatedValue, null, 2);

  // Clear existing value and paste new valid JSON
  await user.clear(valueInput);
  valueInput.focus();
  await user.paste(updatedValueString);
  await user.click(submitButton);

  // Check that the mutation function was called
  expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);

  // Check that the mutation function was called with the correct arguments
  expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
    where: { key: sampleConfig.key }, // Make sure the key from initial props is used
    data: { value: updatedValue }, // Expect the JS object
  });

  // After successful submission, onClose should be called
  expect(onClose).toHaveBeenCalled();
});

test("calls onClose when cancel button is clicked", async () => {
  const { user, onClose } = renderOpen();

  expect(
    screen.getByRole("heading", { name: "admin.appConfig.editConfig" })
  ).toBeVisible();

  const cancelButton = screen.getByRole("button", {
    name: "common.cancel",
  });
  await user.click(cancelButton);

  expect(onClose).toHaveBeenCalled();
  expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
});
