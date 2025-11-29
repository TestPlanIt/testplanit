// File: testplanit/app/[locale]/admin/app-config/app-config.hooks.mock.ts
import { vi } from "vitest";

// Create the mock functions here
export const mockUseFindManyAppConfig = vi.fn();
export const mockCreateMutateAsync = vi.fn();
export const mockUpdateMutateAsync = vi.fn();

// Define the mock hook implementations using the functions above
export const useFindManyAppConfig = mockUseFindManyAppConfig;
export const useCreateAppConfig = () => ({
  mutateAsync: mockCreateMutateAsync,
});
export const useUpdateAppConfig = () => ({
  mutateAsync: mockUpdateMutateAsync,
});

// Helper function to reset mocks, callable from tests
export const resetAppConfigHooksMocks = () => {
  mockUseFindManyAppConfig.mockClear();
  mockCreateMutateAsync.mockClear();
  mockUpdateMutateAsync.mockClear();
  // Remove default return value setting - tests will set it explicitly
  // mockUseFindManyAppConfig.mockReturnValue({ data: [], isLoading: false });
};
