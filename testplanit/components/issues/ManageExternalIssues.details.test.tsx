import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A linked issue's badge opens a details popover for every tracker, not only
 * Jira, through the provider-neutral details route.
 */

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./search-issues-dialog", () => ({
  SearchIssuesDialog: () => null,
}));

import { ManageExternalIssues } from "./ManageExternalIssues";

const linkedIssue = {
  id: 700,
  key: "#7",
  summary: "Crash on upload",
  externalId: "7",
  url: "https://github.com/acme/app/issues/7",
};

const githubDetails = {
  key: "#7",
  url: linkedIssue.url,
  summary: "Crash on upload",
  description: "Steps",
  status: { name: "open", color: "blue" },
  priority: null,
  assignee: { displayName: "ada" },
  assignees: [{ displayName: "ada" }],
  reporter: null,
  issueType: { name: "Issue" },
  labels: ["bug", "P1"],
  labelColors: { bug: "d73a4a" },
  milestone: { name: "v1.2", state: "open" },
  commentCount: 2,
  updated: "2026-10-02T00:00:00.000Z",
};

const mockFetch = vi.fn();

describe("ManageExternalIssues — details popover", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/issue-details")) {
        return { ok: true, json: async () => githubDetails };
      }
      return { ok: true, json: async () => ({ linkedIssues: [linkedIssue] }) };
    });
  });

  it("fetches and renders a GitHub issue's details on hover", async () => {
    render(
      <ManageExternalIssues
        testCaseId={42}
        projectId={1}
        projectIntegrationId={11}
        integrationId={3}
        provider="GITHUB"
      />
    );

    const badge = await screen.findByText("#7: Crash on upload");
    fireEvent.mouseEnter(badge.closest(".w-full.max-w-full") ?? badge);

    expect(await screen.findByText("v1.2")).toBeInTheDocument();
    const detailsCalls = mockFetch.mock.calls
      .map(([url]: any[]) => String(url))
      .filter((url) => url.includes("/issue-details"));
    expect(detailsCalls).toEqual([
      "/api/integrations/issue-details?issueKey=%237&integrationId=3",
    ]);
    expect(screen.getByText("bug")).toHaveStyle({
      borderColor: "rgb(215, 58, 74)",
    });
    expect(screen.getByText("P1")).not.toHaveAttribute("style");
    expect(screen.getByText("ada")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("asks nothing of a tracker it cannot query", async () => {
    render(
      <ManageExternalIssues
        testCaseId={42}
        projectId={1}
        projectIntegrationId={11}
        integrationId={3}
        provider="SIMPLE_URL"
      />
    );

    const badge = await screen.findByText("#7: Crash on upload");
    fireEvent.mouseEnter(badge.closest(".w-full.max-w-full") ?? badge);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 300));
    const detailsCalls = mockFetch.mock.calls
      .map(([url]: any[]) => String(url))
      .filter((url) => url.includes("/issue-details"));
    expect(detailsCalls).toHaveLength(0);
  });
});
