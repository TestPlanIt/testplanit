import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() to prevent infinite re-renders ---
const { mockUseFindFirstProjects } = vi.hoisted(() => ({
  mockUseFindFirstProjects: vi.fn(),
}));

// --- Mocks ---

vi.mock("~/lib/hooks", () => ({
  useFindFirstProjects: mockUseFindFirstProjects,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Mock child managers as simple stubs with data-testid
vi.mock("./ManageExternalIssues", () => ({
  ManageExternalIssues: ({ provider }: any) => (
    <div data-testid="manage-external-issues" data-provider={provider} />
  ),
}));

vi.mock("./ManageSimpleUrlIssues", () => ({
  ManageSimpleUrlIssues: () => (
    <div data-testid="manage-simple-url-issues" />
  ),
}));

vi.mock("./DeferredIssueManager", () => ({
  DeferredIssueManager: () => (
    <div data-testid="deferred-issue-manager" />
  ),
}));

// Mock @prisma/client enums for jsdom
vi.mock("@prisma/client", () => ({
  IntegrationProvider: {
    JIRA: "JIRA",
    GITHUB: "GITHUB",
    AZURE_DEVOPS: "AZURE_DEVOPS",
    SIMPLE_URL: "SIMPLE_URL",
  },
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children, ...rest }: any) => (
    <div role="alert" {...rest}>
      {children}
    </div>
  ),
  AlertDescription: ({ children, ...rest }: any) => (
    <div data-testid="alert-description" {...rest}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...rest }: any) =>
    asChild ? (
      React.cloneElement(React.Children.only(children) as React.ReactElement, rest)
    ) : (
      <button {...rest}>{children}</button>
    ),
}));

import { UnifiedIssueManager } from "./UnifiedIssueManager";

const defaultProps = {
  projectId: 1,
  linkedIssueIds: [],
  setLinkedIssueIds: vi.fn(),
  entityType: "testCase" as const,
  entityId: 42,
};

describe("UnifiedIssueManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading skeleton when isLoading is true", () => {
    mockUseFindFirstProjects.mockReturnValue({ data: undefined, isLoading: true });

    const { container } = render(<UnifiedIssueManager {...defaultProps} />);

    const skeleton = container.querySelector(".animate-pulse");
    expect(skeleton).toBeTruthy();
  });

  it("renders ManageSimpleUrlIssues when project has active SIMPLE_URL integration and entityId > 0", () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: {
        projectIntegrations: [
          {
            id: 10,
            isActive: true,
            config: {},
            integration: { id: 5, name: "Simple Links", provider: "SIMPLE_URL" },
          },
        ],
      },
      isLoading: false,
    });

    render(<UnifiedIssueManager {...defaultProps} entityId={42} />);

    expect(screen.getByTestId("manage-simple-url-issues")).toBeTruthy();
    expect(screen.queryByTestId("manage-external-issues")).toBeNull();
    expect(screen.queryByTestId("deferred-issue-manager")).toBeNull();
  });

  it("renders ManageExternalIssues when project has active JIRA integration and entityId > 0", () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: {
        projectIntegrations: [
          {
            id: 20,
            isActive: true,
            config: {},
            integration: { id: 7, name: "My Jira", provider: "JIRA" },
          },
        ],
      },
      isLoading: false,
    });

    render(<UnifiedIssueManager {...defaultProps} entityId={42} />);

    expect(screen.getByTestId("manage-external-issues")).toBeTruthy();
    expect(screen.queryByTestId("manage-simple-url-issues")).toBeNull();
    expect(screen.queryByTestId("deferred-issue-manager")).toBeNull();
  });

  it("renders DeferredIssueManager when project has active integration but no entityId", () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: {
        projectIntegrations: [
          {
            id: 20,
            isActive: true,
            config: {},
            integration: { id: 7, name: "My Jira", provider: "JIRA" },
          },
        ],
      },
      isLoading: false,
    });

    render(<UnifiedIssueManager {...defaultProps} entityId={undefined} />);

    expect(screen.getByTestId("deferred-issue-manager")).toBeTruthy();
    expect(screen.queryByTestId("manage-external-issues")).toBeNull();
    expect(screen.queryByTestId("manage-simple-url-issues")).toBeNull();
  });

  it("renders DeferredIssueManager when entityId is 0", () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: {
        projectIntegrations: [
          {
            id: 20,
            isActive: true,
            config: {},
            integration: { id: 7, name: "My Jira", provider: "JIRA" },
          },
        ],
      },
      isLoading: false,
    });

    render(<UnifiedIssueManager {...defaultProps} entityId={0} />);

    expect(screen.getByTestId("deferred-issue-manager")).toBeTruthy();
  });

  it("renders alert with configure integration link when project has no active integrations", () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: {
        projectIntegrations: [],
      },
      isLoading: false,
    });

    render(<UnifiedIssueManager {...defaultProps} />);

    expect(screen.getByRole("alert")).toBeTruthy();
    // Should show a link to integrations settings
    const link = screen.getByRole("link");
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toContain("integrations");
  });

  it("renders alert when project is not found (data is undefined)", () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    render(<UnifiedIssueManager {...defaultProps} />);

    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
