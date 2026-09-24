import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string) => string>();
  return {
    useTranslations: (namespace = "") => {
      if (!cache.has(namespace)) {
        cache.set(namespace, (key: string) => `${namespace}.${key}`);
      }
      return cache.get(namespace)!;
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./SharedReportViewer", () => ({
  SharedReportViewer: ({ shareData, shareMode, isAuthenticatedUser }: any) => (
    <div data-testid="shared-report-viewer">
      <span data-testid="viewer-share-key">{shareData.shareKey}</span>
      <span data-testid="viewer-mode">{shareMode}</span>
      <span data-testid="viewer-authenticated">
        {String(isAuthenticatedUser)}
      </span>
    </div>
  ),
}));
vi.mock("./PasswordGate", () => ({
  PasswordGate: () => <div data-testid="password-gate" />,
}));
vi.mock("./SharedReportLoading", () => ({
  SharedReportLoading: () => <div data-testid="shared-report-loading" />,
}));

import { ShareContent } from "./ShareContent";

const SHARE_KEY = "k1";
const fetchMock = vi.fn();
const originalLocation = window.location;

const session = {
  user: { id: "u1", name: "Morgan Diaz", email: "morgan@example.com" },
  expires: "2099-01-01T00:00:00.000Z",
} as any;

const frozenMeta = {
  capturedAt: "2026-09-20T10:00:00.000Z",
  capturedByName: null,
  rowCount: 1,
  totalRowCount: 1,
  truncated: false,
};

function shareData(overrides: Record<string, unknown> = {}) {
  return {
    shareKey: SHARE_KEY,
    entityType: "REPORT",
    mode: "AUTHENTICATED",
    projectId: 7,
    projectName: "Alpha",
    entityConfig: { reportType: "repository-stats", dimensions: ["user"] },
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function postBodies() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url,
    method: init?.method,
    body: JSON.parse(init?.body ?? "null"),
  }));
}

describe("ShareContent", () => {
  beforeEach(() => {
    sessionStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ...shareData(), title: "Weekly" })
    );
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        href: `http://localhost/share/${SHARE_KEY}`,
        pathname: `/share/${SHARE_KEY}`,
        origin: "http://localhost",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("sends a signed-in viewer of a live authenticated link to the project's Reports page", async () => {
    render(
      <ShareContent
        shareKey={SHARE_KEY}
        shareData={shareData()}
        session={session}
      />
    );

    await waitFor(() =>
      expect(window.location.href).toMatch(/^\/projects\/reports\/7\?/)
    );
    expect(window.location.href).toContain("reportType=repository-stats");
    expect(postBodies()).toEqual([
      { url: `/api/share/${SHARE_KEY}`, method: "POST", body: {} },
    ]);
    expect(screen.queryByTestId("shared-report-viewer")).toBeNull();
  });

  it("keeps a signed-in viewer of a frozen authenticated link on the share page", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ...shareData({ frozen: frozenMeta }), title: "Weekly" })
    );
    render(
      <ShareContent
        shareKey={SHARE_KEY}
        shareData={shareData({ frozen: frozenMeta })}
        session={session}
      />
    );

    expect(
      await screen.findByTestId("shared-report-viewer")
    ).toBeInTheDocument();
    expect(screen.getByTestId("viewer-authenticated")).toHaveTextContent(
      "true"
    );
    expect(window.location.href).toBe(`http://localhost/share/${SHARE_KEY}`);
    expect(postBodies()).toEqual([
      {
        url: `/api/share/${SHARE_KEY}`,
        method: "POST",
        body: { token: null },
      },
    ]);
  });

  it("sends a cross-project live link to the admin Reports page", async () => {
    render(
      <ShareContent
        shareKey={SHARE_KEY}
        shareData={shareData({
          projectId: null,
          entityConfig: {
            reportType: "cross-project-repository-stats",
            mode: "cross-project",
          },
        })}
        session={session}
      />
    );

    await waitFor(() =>
      expect(window.location.href).toMatch(/^\/admin\/reports\?/)
    );
  });

  it("sends a saved report link to the project stored in its config", async () => {
    render(
      <ShareContent
        shareKey={SHARE_KEY}
        shareData={shareData({
          entityType: "SAVED_REPORT",
          projectId: null,
          entityConfig: { reportType: "repository-stats", projectId: 42 },
        })}
        session={session}
      />
    );

    await waitFor(() =>
      expect(window.location.href).toMatch(/^\/projects\/reports\/42\?/)
    );
    expect(window.location.href).not.toContain("projectId=");
  });

  it("does not count a second view in the same session", async () => {
    sessionStorage.setItem(`share_viewed_${SHARE_KEY}`, "true");
    render(
      <ShareContent
        shareKey={SHARE_KEY}
        shareData={shareData({ mode: "PUBLIC" })}
        session={null}
      />
    );

    expect(
      await screen.findByTestId("shared-report-viewer")
    ).toBeInTheDocument();
    expect(postBodies()).toEqual([
      {
        url: `/api/share/${SHARE_KEY}`,
        method: "POST",
        body: { token: null, recordView: false },
      },
    ]);
  });

  it("redirects a repeat live authenticated visit without posting again", async () => {
    sessionStorage.setItem(`share_viewed_${SHARE_KEY}`, "true");
    render(
      <ShareContent
        shareKey={SHARE_KEY}
        shareData={shareData()}
        session={session}
      />
    );

    await waitFor(() =>
      expect(window.location.href).toMatch(/^\/projects\/reports\/7\?/)
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts the first view of a public link", async () => {
    render(
      <ShareContent
        shareKey={SHARE_KEY}
        shareData={shareData({ mode: "PUBLIC" })}
        session={null}
      />
    );

    expect(
      await screen.findByTestId("shared-report-viewer")
    ).toBeInTheDocument();
    const [call] = postBodies();
    expect(call.url).toBe(`/api/share/${SHARE_KEY}`);
    expect(call.body).not.toHaveProperty("recordView");
    expect(sessionStorage.getItem(`share_viewed_${SHARE_KEY}`)).toBe("true");
  });
});
