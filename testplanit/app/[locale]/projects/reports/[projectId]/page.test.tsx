import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockNotFound = vi.hoisted(() => vi.fn());
const mockUseProjectPermissions = vi.hoisted(() => vi.fn());
const mockUseRequireAuth = vi.hoisted(() => vi.fn());
const mockUseFindFirst = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
  useParams: () => ({ projectId: "10" }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: mockUseProjectPermissions,
}));

vi.mock("~/hooks/useRequireAuth", () => ({
  useRequireAuth: mockUseRequireAuth,
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({ projects: { useFindFirst: mockUseFindFirst } }),
}));

vi.mock("~/components/reports/ReportBuilder", () => ({
  ReportBuilder: ({ projectId }: { projectId: number }) => (
    <div data-testid="report-builder" data-project-id={projectId} />
  ),
}));

vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => <span data-testid="help-popover" />,
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: () => <span data-testid="project-icon" />,
}));

vi.mock("@/components/Loading", () => ({
  Loading: () => <div data-testid="loading" />,
}));

import ProjectReportsPage from "./page";

const noPerms = { canAddEdit: false, canDelete: false, canClose: false };

/** Signed-in session at the given system access level. */
function sessionAs(access: string) {
  return {
    session: { user: { id: "u1", access } },
    status: "authenticated",
    isLoading: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRequireAuth.mockReturnValue(sessionAs("USER"));
  mockUseFindFirst.mockReturnValue({
    data: { id: 10, name: "Analytics", iconUrl: null, assignedUsers: [] },
    isLoading: false,
  });
  mockUseProjectPermissions.mockReturnValue({
    permissions: noPerms,
    isProjectAdmin: false,
    isLoading: false,
    error: null,
  });
});

describe("ProjectReportsPage access control", () => {
  it("renders for a system USER whose project role grants Reporting", async () => {
    // Regression: the page used to gate on session.user.access being
    // ADMIN/PROJECTADMIN, so a USER holding the Reporting grant saw the
    // Reports link in ProjectMenu and then a 404 on click.
    mockUseProjectPermissions.mockReturnValue({
      permissions: { ...noPerms, canAddEdit: true },
      isProjectAdmin: false,
      isLoading: false,
      error: null,
    });

    render(<ProjectReportsPage />);

    expect(await screen.findByTestId("report-builder")).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("resolves permissions for the Reporting area of this project", () => {
    render(<ProjectReportsPage />);

    expect(mockUseProjectPermissions).toHaveBeenCalledWith(10, "Reporting");
  });

  it("renders when the grant is Reporting delete only", async () => {
    mockUseProjectPermissions.mockReturnValue({
      permissions: { ...noPerms, canDelete: true },
      isProjectAdmin: false,
      isLoading: false,
      error: null,
    });

    render(<ProjectReportsPage />);

    expect(await screen.findByTestId("report-builder")).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("still renders for a system ADMIN (resolved to all-areas-granted)", async () => {
    mockUseRequireAuth.mockReturnValue(sessionAs("ADMIN"));
    mockUseProjectPermissions.mockReturnValue({
      permissions: { canAddEdit: true, canDelete: true, canClose: true },
      isProjectAdmin: true,
      isLoading: false,
      error: null,
    });

    render(<ProjectReportsPage />);

    expect(await screen.findByTestId("report-builder")).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("404s when the user holds no Reporting permission", async () => {
    render(<ProjectReportsPage />);

    await waitFor(() => expect(mockNotFound).toHaveBeenCalled());
  });

  it("404s when the project is missing", async () => {
    mockUseProjectPermissions.mockReturnValue({
      permissions: { ...noPerms, canAddEdit: true },
      isProjectAdmin: false,
      isLoading: false,
      error: null,
    });
    mockUseFindFirst.mockReturnValue({ data: null, isLoading: false });

    render(<ProjectReportsPage />);

    await waitFor(() => expect(mockNotFound).toHaveBeenCalled());
  });

  it("waits for permissions to resolve before deciding", () => {
    mockUseProjectPermissions.mockReturnValue({
      permissions: null,
      isProjectAdmin: false,
      isLoading: true,
      error: null,
    });

    render(<ProjectReportsPage />);

    expect(screen.getByTestId("loading")).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
