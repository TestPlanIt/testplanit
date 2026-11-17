import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The hover popover asks the tracker for live details through the
 * provider-neutral route, whatever the provider. Jira keeps the fields it
 * has always shown; a tracker that reports labels, a milestone or several
 * assignees gets those rows too.
 */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock("~/hooks/useIssueUpdateStream", () => ({
  useIssueUpdateStream: () => undefined,
}));

vi.mock("@/hooks/useIssueColors", () => ({
  useIssueColors: () => ({
    getStatusColor: () => "#888",
    getPriorityColor: () => "#888",
    getPriorityStyle: () => ({}),
    getStatusStyle: () => ({}),
  }),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: { useFindUnique: () => ({ data: undefined }) },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

import { IssuesDisplay } from "./IssuesDisplay";

const jiraDetails = {
  key: "PROJ-1",
  url: "https://example.atlassian.net/browse/PROJ-1",
  summary: "Sample",
  description: "<p>Steps</p>",
  status: { name: "In Progress", color: "blue" },
  priority: { name: "High" },
  assignee: { displayName: "Ada" },
  assignees: [{ displayName: "Ada" }],
  reporter: null,
  issueType: { name: "Bug" },
  labels: ["auth"],
  milestone: null,
  commentCount: null,
  updated: "2026-10-02T00:00:00.000Z",
};

const githubDetails = {
  key: "#7",
  url: "https://github.com/acme/app/issues/7",
  summary: "Crash on upload",
  description: "Steps",
  status: { name: "open", color: "blue" },
  priority: null,
  assignee: { displayName: "ada" },
  assignees: [{ displayName: "ada" }, { displayName: "grace" }],
  reporter: null,
  issueType: { name: "Issue" },
  labels: ["bug", "P1"],
  milestone: { name: "v1.2", state: "open" },
  commentCount: 2,
  updated: "2026-10-02T00:00:00.000Z",
};

function hover(text: string) {
  const badge = screen.getByText(text);
  fireEvent.mouseEnter(badge.closest(".group") ?? badge);
}

const detailsCalls = () =>
  mockFetch.mock.calls
    .map(([url]: any[]) => String(url))
    .filter((url) => url.includes("/issue-details"));

describe("IssuesDisplay — tracker details popover", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches a Jira issue through the neutral route and renders its fields", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      String(url).includes("/issue-details")
        ? { ok: true, json: async () => jiraDetails }
        : { ok: true, json: async () => ({}) }
    );

    render(
      <IssuesDisplay
        id={1}
        name="PROJ-1"
        externalId="PROJ-1"
        externalUrl="https://example.atlassian.net/browse/PROJ-1"
        title="Sample"
        integrationProvider="JIRA"
        integrationId={4}
        projectIds={[1]}
        lastSyncedAt={new Date()}
      />
    );
    hover("PROJ-1: Sample");

    expect(await screen.findByText("High")).toBeInTheDocument();
    expect(detailsCalls()).toEqual([
      "/api/integrations/issue-details?issueKey=PROJ-1&integrationId=4",
    ]);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    // Jira's popover never listed labels; it still does not.
    expect(screen.queryByText("auth")).not.toBeInTheDocument();
  });

  it("shows a GitHub issue's assignees, labels and milestone once the tracker answers", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      String(url).includes("/issue-details")
        ? { ok: true, json: async () => githubDetails }
        : { ok: true, json: async () => ({}) }
    );

    render(
      <IssuesDisplay
        id={2}
        name="#7"
        externalId="7"
        externalUrl="https://github.com/acme/app/issues/7"
        title="Crash on upload"
        status="open"
        integrationProvider="GITHUB"
        integrationId={3}
        projectIds={[1]}
        lastSyncedAt={new Date()}
      />
    );
    hover("#7: Crash on upload");

    expect(await screen.findByText("v1.2")).toBeInTheDocument();
    expect(detailsCalls()).toEqual([
      "/api/integrations/issue-details?issueKey=%237&integrationId=3",
    ]);
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("ada, grace")).toBeInTheDocument();
  });

  it("keeps the local popover when the tracker cannot be reached", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      String(url).includes("/issue-details")
        ? { ok: false, status: 500, json: async () => ({ error: "boom" }) }
        : { ok: true, json: async () => ({}) }
    );

    render(
      <IssuesDisplay
        id={3}
        name="#8"
        externalUrl="https://github.com/acme/app/issues/8"
        title="Flaky"
        status="closed"
        integrationProvider="GITHUB"
        integrationId={3}
        projectIds={[1]}
        lastSyncedAt={new Date()}
      />
    );
    hover("#8: Flaky");

    await waitFor(() => expect(detailsCalls()).toHaveLength(1));
    expect(await screen.findByText("closed")).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("asks nothing of a plain URL link", () => {
    render(
      <IssuesDisplay
        id={4}
        name="EXT-1"
        externalUrl="https://tracker.example/EXT-1"
        title="Linked"
        integrationProvider="SIMPLE_URL"
        integrationId={5}
        projectIds={[1]}
        lastSyncedAt={new Date()}
      />
    );
    hover("EXT-1: Linked");

    expect(detailsCalls()).toHaveLength(0);
  });
});
