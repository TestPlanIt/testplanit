import { test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { EditAppConfigModal } from "./EditAppConfig";

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

// Helper to wrap component in QueryClientProvider
const queryClient = new QueryClient();
const renderWithProvider = (configProp = sampleConfig) => {
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <EditAppConfigModal config={configProp} />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  // Reset mocks before each test
  mockUpdateMutateAsync.mockClear();
});

test("renders the edit button", () => {
  renderWithProvider();
  expect(screen.getByRole("button")).toBeInTheDocument();
});

test("opens modal and shows initial data when edit button is clicked", async () => {
  const { user } = renderWithProvider();
  const editButton = screen.getByRole("button");
  await user.click(editButton);

  // Check if the dialog title is visible
  expect(
    screen.getByRole("heading", { name: "admin.appConfig.editConfig" })
  ).toBeVisible();
  // Check if the key is displayed (using mock translation)
  expect(screen.getByText("common.fields.configKeys.sample_key")).toBeVisible();
  // Check if the value textarea has the correct initial stringified JSON
  expect(
    screen.getByLabelText("common.fields.value", { selector: "textarea" })
  ).toHaveValue(JSON.stringify(sampleConfig.value, null, 2));
});

test("shows validation error for invalid JSON", async () => {
  const { user } = renderWithProvider();
  const editButton = screen.getByRole("button");
  await user.click(editButton);

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

test("calls update mutation with parsed data on successful submission", async () => {
  mockUpdateMutateAsync.mockResolvedValue({});
  const { user } = renderWithProvider();
  const editButton = screen.getByRole("button");
  await user.click(editButton);

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

  // Optional: Check if modal closes
  // expect(screen.queryByRole("heading", { name: "admin.appConfig.editConfig" })).not.toBeInTheDocument();
});

test("closes modal when cancel button is clicked", async () => {
  const { user } = renderWithProvider();
  const editButton = screen.getByRole("button");
  await user.click(editButton);

  expect(
    screen.getByRole("heading", { name: "admin.appConfig.editConfig" })
  ).toBeVisible();

  const cancelButton = screen.getByRole("button", {
    name: "common.actions.cancel",
  });
  await user.click(cancelButton);

  expect(
    screen.queryByRole("heading", { name: "admin.appConfig.editConfig" })
  ).not.toBeInTheDocument();
  expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
});

// Remove placeholder comment
// // --- Add more tests here for validation, submission, etc. ---
