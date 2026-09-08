import { render, screen } from "@testing-library/react";
import { ApplicationArea } from "~/zenstack/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssigneeCombobox } from "./AssigneeCombobox";

const mockSearchProjectMembers = vi.fn();
vi.mock("~/app/actions/searchProjectMembers", () => ({
  searchProjectMembers: (...args: unknown[]) =>
    mockSearchProjectMembers(...args),
}));

const mockGetProjectEligibleRoles = vi.fn();
vi.mock("~/app/actions/getProjectEligibleRoles", () => ({
  getProjectEligibleRoles: (...args: unknown[]) =>
    mockGetProjectEligibleRoles(...args),
}));

const mockUseQuery = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: (config: { queryFn: () => unknown }) => {
    mockUseQuery(config);
    // Call the queryFn synchronously so getProjectEligibleRoles is
    // captured with its real second argument.
    try {
      config.queryFn?.();
    } catch {
      /* ignore */
    }
    return { data: [], isLoading: false };
  },
}));

vi.mock("@/components/Avatar", () => ({
  Avatar: ({ alt }: { alt?: string }) => (
    <span data-testid="avatar-stub" data-alt={alt} />
  ),
}));

describe("AssigneeCombobox requireCanApproveOn", () => {
  beforeEach(() => {
    mockSearchProjectMembers.mockReset().mockResolvedValue({
      results: [],
      total: 0,
    });
    mockGetProjectEligibleRoles.mockReset().mockResolvedValue([]);
    mockUseQuery.mockReset();
  });

  it("Test A: passes requireCanApproveOn into getProjectEligibleRoles when prop supplied", () => {
    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={vi.fn()}
        requireCanApproveOn={ApplicationArea.TestCaseRepository}
      />
    );

    expect(mockGetProjectEligibleRoles).toHaveBeenCalledWith(42, {
      requireCanApproveOn: ApplicationArea.TestCaseRepository,
    });
  });

  it("Test B: omitting the prop calls getProjectEligibleRoles with no options object", () => {
    render(
      <AssigneeCombobox projectId={42} value={null} onValueChange={vi.fn()} />
    );

    expect(mockGetProjectEligibleRoles).toHaveBeenCalledWith(42, undefined);
  });

  it("Test C: includes requireCanApproveOn in the useQuery queryKey for cache busting", () => {
    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={vi.fn()}
        requireCanApproveOn={ApplicationArea.TestRuns}
      />
    );

    const calls = mockUseQuery.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const queryKey = calls[0][0].queryKey;
    expect(queryKey).toContain(ApplicationArea.TestRuns);
  });

  it("Test D: trigger renders without crashing when the prop is set", () => {
    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={vi.fn()}
        requireCanApproveOn={ApplicationArea.Sessions}
      />
    );
    expect(screen.getByTestId("assignee-combobox")).toBeInTheDocument();
  });
});
