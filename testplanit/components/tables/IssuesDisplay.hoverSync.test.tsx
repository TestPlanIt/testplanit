import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hover-sync freshness: the client must not POST /api/issues/[id]/sync at
 * all when the row's own `lastSyncedAt` is inside the server's 300s hover
 * window — the round-trip would only return `cached: true`.
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
  }),
}));

import { IssuesDisplay } from "./IssuesDisplay";

const baseProps = {
  name: "PROJ-1",
  externalId: "PROJ-1",
  externalUrl: "https://example.atlassian.net/browse/PROJ-1",
  title: "Sample",
  integrationProvider: "JIRA",
  integrationId: 4,
  projectIds: [370],
};

function hoverBadge() {
  const badge = screen.getByText("PROJ-1: Sample");
  // The mouseenter handler lives on the outer wrapper.
  fireEvent.mouseEnter(badge.closest(".group") ?? badge);
}

describe("IssuesDisplay — hover sync freshness", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("skips the sync POST entirely when lastSyncedAt is inside the 300s window", () => {
    render(
      <IssuesDisplay
        {...baseProps}
        id={9001}
        lastSyncedAt={new Date(Date.now() - 60_000)}
      />
    );
    hoverBadge();
    const syncCalls = mockFetch.mock.calls.filter(([url]: any[]) =>
      String(url).includes("/sync")
    );
    expect(syncCalls).toHaveLength(0);
  });

  it("POSTs the hover sync when lastSyncedAt is older than the window", () => {
    render(
      <IssuesDisplay
        {...baseProps}
        id={9002}
        lastSyncedAt={new Date(Date.now() - 10 * 60_000)}
      />
    );
    hoverBadge();
    const syncCalls = mockFetch.mock.calls.filter(([url]: any[]) =>
      String(url).includes("/sync")
    );
    expect(syncCalls).toHaveLength(1);
    expect(String(syncCalls[0][0])).toBe("/api/issues/9002/sync?trigger=hover");
  });

  it("POSTs the hover sync when lastSyncedAt is unknown", () => {
    render(<IssuesDisplay {...baseProps} id={9003} lastSyncedAt={null} />);
    hoverBadge();
    const syncCalls = mockFetch.mock.calls.filter(([url]: any[]) =>
      String(url).includes("/sync")
    );
    expect(syncCalls).toHaveLength(1);
  });
});
