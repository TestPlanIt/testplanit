import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => {
  // Stable per namespace, like the real hook: the viewer refetches when `t`
  // changes identity.
  const cache = new Map<string, (key: string) => string>();
  return {
    useTranslations: (namespace = "") => {
      if (!cache.has(namespace)) {
        cache.set(namespace, (key: string) => `${namespace}.${key}`);
      }
      return cache.get(namespace)!;
    },
    useLocale: () => "en-US",
  };
});
vi.mock("~/hooks/useReportCsvExport", () => ({
  useReportCsvExport: () => ({ isExporting: false, exportCsv: vi.fn() }),
}));
vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} data-testid="view-in-full-app-link" {...props}>
      {children}
    </a>
  ),
}));
vi.mock("./FrozenReportBanner", () => ({
  FrozenReportBanner: ({ frozen }: any) => (
    <div data-testid="frozen-report-banner">{frozen.capturedAt}</div>
  ),
}));
vi.mock("@/components/reports/ReportRenderer", () => ({
  ReportRenderer: ({ results, projectId, reportType, readOnly }: any) => (
    <div data-testid="report-renderer">
      <span data-testid="renderer-project-id">{String(projectId)}</span>
      <span data-testid="renderer-report-type">{reportType}</span>
      <span data-testid="renderer-read-only">{String(readOnly)}</span>
      <span data-testid="renderer-results">
        {results.map((r: any) => r.id).join(",")}
      </span>
    </div>
  ),
}));

import { StaticReportViewer } from "./StaticReportViewer";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const reportPayload = {
  results: [{ id: 3 }, { id: 1 }, { id: 2 }],
  dimensions: [],
  metrics: [],
};

const frozenMeta = {
  capturedAt: "2026-09-20T10:00:00.000Z",
  capturedByName: "Morgan Diaz",
  rowCount: 3,
  totalRowCount: 3,
  truncated: false,
};

function shareData(overrides: Record<string, unknown> = {}) {
  return {
    shareKey: "abc",
    entityType: "REPORT",
    title: "Weekly",
    projectId: 7,
    entityConfig: { reportType: "repository-stats", dimensions: ["user"] },
    ...overrides,
  };
}

describe("StaticReportViewer", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/share/abc");
    sessionStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse(reportPayload));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  it("loads the report from the share's report endpoint and renders it in server order", async () => {
    render(<StaticReportViewer shareData={shareData()} shareMode="PUBLIC" />);

    expect(await screen.findByTestId("report-renderer")).toBeInTheDocument();
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/share/abc/report");
    expect(url.searchParams.get("token")).toBeNull();
    expect(screen.getByTestId("renderer-results")).toHaveTextContent("3,1,2");
    expect(screen.getByTestId("renderer-project-id")).toHaveTextContent("7");
    expect(screen.getByTestId("renderer-read-only")).toHaveTextContent("true");
  });

  it("accepts a saved report share", async () => {
    render(
      <StaticReportViewer
        shareData={shareData({ entityType: "SAVED_REPORT" })}
        shareMode="AUTHENTICATED"
      />
    );

    expect(await screen.findByTestId("report-renderer")).toBeInTheDocument();
    expect(
      screen.queryByText("reports.sharedReport.errors.onlyReportSharing")
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects entity types other than reports", async () => {
    render(
      <StaticReportViewer
        shareData={shareData({ entityType: "SEARCH" })}
        shareMode="PUBLIC"
      />
    );

    expect(
      await screen.findByText("reports.sharedReport.errors.onlyReportSharing")
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes a saved report's project from its config", async () => {
    render(
      <StaticReportViewer
        shareData={shareData({
          entityType: "SAVED_REPORT",
          projectId: null,
          entityConfig: { reportType: "repository-stats", projectId: 42 },
        })}
        shareMode="AUTHENTICATED"
        isAuthenticatedUser
      />
    );

    expect(await screen.findByTestId("renderer-project-id")).toHaveTextContent(
      "42"
    );
    expect(screen.getByTestId("view-in-full-app-link")).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/projects\/reports\/42\?/)
    );
  });

  it("links a signed-in viewer of a live report to the full app", async () => {
    render(
      <StaticReportViewer
        shareData={shareData()}
        shareMode="PASSWORD_PROTECTED"
        isAuthenticatedUser
      />
    );

    await screen.findByTestId("report-renderer");
    expect(screen.getByTestId("view-in-full-app-link")).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/projects\/reports\/7\?/)
    );
    expect(screen.queryByTestId("frozen-report-banner")).toBeNull();
  });

  it("shows the frozen banner and no full-app link for a frozen report", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...reportPayload, frozen: frozenMeta })
    );
    render(
      <StaticReportViewer
        shareData={shareData()}
        shareMode="PASSWORD_PROTECTED"
        isAuthenticatedUser
      />
    );

    expect(await screen.findByTestId("frozen-report-banner")).toHaveTextContent(
      frozenMeta.capturedAt
    );
    expect(screen.queryByTestId("view-in-full-app-link")).toBeNull();
  });

  it("sends the verified password token with the report request", async () => {
    sessionStorage.setItem(
      "share_token_abc",
      JSON.stringify({ token: "tok-123" })
    );
    render(
      <StaticReportViewer
        shareData={shareData()}
        shareMode="PASSWORD_PROTECTED"
      />
    );

    await screen.findByTestId("report-renderer");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/share/abc/report");
    expect(url.searchParams.get("token")).toBe("tok-123");
  });

  it("shows the server's error when the report request fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse({ error: "Link expired" }, false));
    render(<StaticReportViewer shareData={shareData()} shareMode="PUBLIC" />);

    expect(await screen.findByText("Link expired")).toBeInTheDocument();
    expect(screen.queryByTestId("report-renderer")).toBeNull();
  });
});
