import { describe, it, expect, vi, beforeEach } from "vitest"; // Import vitest functions
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  useProjectPermissions,
  AreaPermissions,
  AllAreaPermissions,
} from "./useProjectPermissions";
// Use the enum definition from your schema
enum ApplicationArea {
  Documentation = "Documentation",
  Milestones = "Milestones",
  TestCaseRepository = "TestCaseRepository",
  TestCaseRestrictedFields = "TestCaseRestrictedFields",
  TestRuns = "TestRuns",
  ClosedTestRuns = "ClosedTestRuns",
  TestRunResults = "TestRunResults",
  TestRunResultRestrictedFields = "TestRunResultRestrictedFields",
  Sessions = "Sessions",
  SessionsRestrictedFields = "SessionsRestrictedFields",
  ClosedSessions = "ClosedSessions",
  SessionResults = "SessionResults",
  Tags = "Tags",
  SharedSteps = "SharedSteps",
  Issues = "Issues",
  IssueIntegration = "IssueIntegration",
  Forecasting = "Forecasting",
  Reporting = "Reporting",
  Settings = "Settings",
}

// Mock next-auth/react entirely within the factory
vi.mock("next-auth/react", () => {
  // Define the mock function inside the factory scope
  const mockUseSessionInside = vi.fn();
  return {
    useSession: mockUseSessionInside,
  };
});

// Get a reference to the mock function AFTER vi.mock has been hoisted and executed
// We need to dynamically import the mocked module to access the mock function.
// This is a bit more complex but ensures we get the correct mock reference.
let mockUseSession: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // Dynamically import the mocked module to get the mock function reference
  const { useSession } = await import("next-auth/react");
  mockUseSession = useSession as ReturnType<typeof vi.fn>;

  // Reset mocks before each test
  mockUseSession.mockClear();
  mockFetch.mockClear();
  // Default session mock
  mockUseSession.mockReturnValue({
    data: { user: { id: mockUserId } },
    status: "authenticated",
  });
  // Default fetch mock (success)
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ ...mockSingleAreaPermissions }),
    text: async () => "",
  });
});

// Mock fetch using vi.fn and vi.stubGlobal
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Helper to create a QueryClient provider wrapper
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // Disable retries for tests
        gcTime: Infinity, // Prevent garbage collection during tests
      },
    },
  });
  // Corrected wrapper component definition
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

// Default mock data
const mockUserId = "user-123";
const mockProjectId = 1;
// Use correct enum member from schema
const mockArea: ApplicationArea = ApplicationArea.TestCaseRepository;

const mockSingleAreaPermissions: AreaPermissions = {
  canAddEdit: true,
  canDelete: false,
  canClose: true,
};

// Use correct enum members from schema for AllAreaPermissions
const mockAllAreaPermissions: AllAreaPermissions = {
  [ApplicationArea.Documentation]: {
    canAddEdit: true,
    canDelete: false,
    canClose: false,
  },
  [ApplicationArea.Milestones]: {
    canAddEdit: false,
    canDelete: true,
    canClose: true,
  },
  [ApplicationArea.TestCaseRepository]: {
    canAddEdit: true,
    canDelete: true,
    canClose: false,
  },
  [ApplicationArea.TestCaseRestrictedFields]: {
    canAddEdit: false,
    canDelete: false,
    canClose: true,
  },
  [ApplicationArea.TestRuns]: {
    canAddEdit: true,
    canDelete: true,
    canClose: true,
  },
  [ApplicationArea.ClosedTestRuns]: {
    canAddEdit: false,
    canDelete: false,
    canClose: false,
  },
  [ApplicationArea.TestRunResults]: {
    canAddEdit: true,
    canDelete: false,
    canClose: false,
  },
  [ApplicationArea.TestRunResultRestrictedFields]: {
    canAddEdit: false,
    canDelete: false,
    canClose: false,
  },
  [ApplicationArea.Sessions]: {
    canAddEdit: true,
    canDelete: false,
    canClose: true,
  },
  [ApplicationArea.SessionsRestrictedFields]: {
    canAddEdit: false,
    canDelete: true,
    canClose: false,
  },
  [ApplicationArea.ClosedSessions]: {
    canAddEdit: true,
    canDelete: true,
    canClose: true,
  },
  [ApplicationArea.SessionResults]: {
    canAddEdit: false,
    canDelete: false,
    canClose: false,
  },
  [ApplicationArea.Tags]: { canAddEdit: true, canDelete: true, canClose: true },
  [ApplicationArea.SharedSteps]: {
    canAddEdit: true,
    canDelete: true,
    canClose: true,
  },
  [ApplicationArea.Issues]: {
    canAddEdit: true,
    canDelete: false,
    canClose: true,
  },
  [ApplicationArea.IssueIntegration]: {
    canAddEdit: false,
    canDelete: false,
    canClose: false,
  },
  [ApplicationArea.Forecasting]: {
    canAddEdit: true,
    canDelete: false,
    canClose: false,
  },
  [ApplicationArea.Reporting]: {
    canAddEdit: false,
    canDelete: false,
    canClose: false,
  },
  [ApplicationArea.Settings]: {
    canAddEdit: true,
    canDelete: false,
    canClose: false,
  },
};

const defaultFalseSingleAreaPermissions: AreaPermissions = {
  canAddEdit: false,
  canDelete: false,
  canClose: false,
};

// Use correct enum members from schema for default AllAreaPermissions
const defaultFalseAllAreaPermissions: AllAreaPermissions = Object.values(
  ApplicationArea
).reduce((acc, key) => {
  acc[key as ApplicationArea] = { ...defaultFalseSingleAreaPermissions }; // Use type assertion
  return acc;
}, {} as AllAreaPermissions);

describe("useProjectPermissions", () => {
  it("should return loading state initially", () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useProjectPermissions(mockProjectId, mockArea),
      { wrapper }
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.permissions).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("should return default permissions if userId is missing", async () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useProjectPermissions(mockProjectId, mockArea),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.permissions).toEqual(
      defaultFalseSingleAreaPermissions
    );
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should return default permissions for all areas if userId is missing", async () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProjectPermissions(mockProjectId), {
      wrapper,
    }); // No area specified

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.permissions).toEqual(defaultFalseAllAreaPermissions);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should return default permissions if projectId is invalid (NaN)", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProjectPermissions(NaN, mockArea), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.permissions).toEqual(
      defaultFalseSingleAreaPermissions
    );
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should return default permissions if projectId is invalid (string that is NaN)", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useProjectPermissions("invalid-project-id", mockArea),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.permissions).toEqual(
      defaultFalseSingleAreaPermissions
    );
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should fetch and return permissions for a specific area", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockSingleAreaPermissions }),
      text: async () => "",
    });
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useProjectPermissions(mockProjectId, mockArea),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.permissions).toEqual(mockSingleAreaPermissions);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/get-user-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: mockUserId,
        projectId: mockProjectId,
        area: mockArea,
      }),
    });
  });

  it("should fetch and return permissions for all areas", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockAllAreaPermissions }),
      text: async () => "",
    });
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProjectPermissions(mockProjectId), {
      wrapper,
    }); // No area specified

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.permissions).toEqual(mockAllAreaPermissions);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/get-user-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: mockUserId,
        projectId: mockProjectId,
        // No area property when fetching all
      }),
    });
  });

  it("should handle fetch errors", async () => {
    const errorMessage = "Failed to fetch";

    // Explicitly clear any previous mock setup for fetch for this test
    mockFetch.mockClear();
    // Make fetch consistently fail for this test case
    mockFetch.mockImplementation(async () => {
      console.log("mockFetch called - failing implementation"); // Add log
      return {
        ok: false,
        status: 500,
        text: async () => errorMessage,
      };
    });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useProjectPermissions(mockProjectId, mockArea),
      { wrapper }
    );

    // Wait until the error state is populated, increase timeout
    await waitFor(
      () => {
        console.log("Inside waitFor:", JSON.stringify(result.current)); // Log current state
        expect(result.current.error).not.toBeNull();
      },
      { timeout: 4000 }
    ); // Increased timeout to 4 seconds

    // Now check the final state
    expect(result.current.isLoading).toBe(false); // isLoading should be false after error
    expect(result.current.permissions).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain(
      `Failed to fetch permissions: 500 ${errorMessage}`
    );
    expect(mockFetch).toHaveBeenCalledTimes(2); // Expect 2 calls due to retry: 1
  });

  it("should use string projectId and convert it", async () => {
    const stringProjectId = "123";
    const numericProjectId = 123;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockSingleAreaPermissions }),
      text: async () => "",
    });
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useProjectPermissions(stringProjectId, mockArea),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.permissions).toEqual(mockSingleAreaPermissions);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/get-user-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: mockUserId,
        projectId: numericProjectId, // Ensure it was converted
        area: mockArea,
      }),
    });
  });

  // TODO: Add test cases for caching/staleTime/gcTime if needed
  // TODO: Add test cases for the `enabled` logic variations if needed
});
