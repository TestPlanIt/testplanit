import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Resolve against the real en-US.json, so these assertions fail if the
// shipped copy changes.
vi.mock("next-intl", async () => {
  const messages = (await import("~/messages/en-US.json")).default as Record<
    string,
    unknown
  >;
  const get = (path: string) =>
    path
      .split(".")
      .reduce<any>((acc, part) => (acc ? acc[part] : undefined), messages);
  return {
    useLocale: () => "en-US",
    useTranslations:
      (namespace?: string) =>
      (key: string, params?: Record<string, unknown>) => {
        const full = namespace ? `${namespace}.${key}` : key;
        let text: string = get(full) ?? full;
        for (const [name, value] of Object.entries(params ?? {})) {
          text = text.replace(`{${name}}`, String(value));
        }
        return text;
      },
  };
});

import {
  NewReleaseNotice,
  type ReleaseCheckResponse,
} from "./NewReleaseNotice";

const fetchMock = vi.fn();

function payload(
  overrides: Partial<ReleaseCheckResponse> = {}
): ReleaseCheckResponse {
  return {
    enabled: true,
    currentVersion: "1.2.0",
    latest: {
      version: "1.2.1",
      url: "https://github.com/TestPlanIt/testplanit/releases/tag/v1.2.1",
      publishedAt: "2026-11-10T00:00:00Z",
    },
    latestOnLine: null,
    checkedAt: "2026-11-14T05:00:00.000Z",
    lastError: null,
    ...overrides,
  };
}

function respond(body: ReleaseCheckResponse, ok = true) {
  return { ok, json: async () => body } as Response;
}

function renderNotice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NewReleaseNotice />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NewReleaseNotice", () => {
  it("names both versions and links to the release notes and upgrade docs", async () => {
    fetchMock.mockResolvedValue(respond(payload()));
    renderNotice();

    expect(
      await screen.findByText(
        "TestPlanIt 1.2.1 is available. This instance runs 1.2.0."
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId("new-release-notice-notes")).toHaveAttribute(
      "href",
      "https://github.com/TestPlanIt/testplanit/releases/tag/v1.2.1"
    );
    expect(screen.getByTestId("new-release-notice-upgrade")).toHaveAttribute(
      "href",
      "https://docs.testplanit.com/docs/docker-setup#updates--maintenance"
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/release-check");
  });

  it("adds the newest release on the running line when there is one", async () => {
    fetchMock.mockResolvedValue(
      respond(
        payload({
          currentVersion: "1.1.20",
          latest: {
            version: "1.2.0",
            url: "https://x/v1.2.0",
            publishedAt: null,
          },
          latestOnLine: {
            version: "1.1.22",
            url: "https://x/v1.1.22",
            publishedAt: null,
          },
        })
      )
    );
    renderNotice();

    expect(
      await screen.findByTestId("new-release-notice-text")
    ).toHaveTextContent(
      "TestPlanIt 1.2.0 is available. This instance runs 1.1.20. 1.1.22 is the newest release on your current line."
    );
  });

  it.each([
    ["nothing newer was found", payload({ latest: null })],
    ["the check is disabled", payload({ enabled: false, latest: null })],
  ])("renders nothing when %s", async (_label, body) => {
    fetchMock.mockResolvedValue(respond(body));
    renderNotice();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("new-release-notice")).not.toBeInTheDocument();
  });

  it("renders nothing when the request is refused", async () => {
    fetchMock.mockResolvedValue(respond(payload(), false));
    renderNotice();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("new-release-notice")).not.toBeInTheDocument();
  });

  it("stays dismissed for that release, and shows again for the next one", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(respond(payload()));
    const first = renderNotice();

    await user.click(await screen.findByTestId("new-release-notice-dismiss"));
    expect(screen.queryByTestId("new-release-notice")).not.toBeInTheDocument();
    first.unmount();

    renderNotice();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("new-release-notice")).not.toBeInTheDocument();

    fetchMock.mockResolvedValue(
      respond(
        payload({
          latest: {
            version: "1.2.2",
            url: "https://x/v1.2.2",
            publishedAt: null,
          },
        })
      )
    );
    renderNotice();
    expect(
      await screen.findByText(
        "TestPlanIt 1.2.2 is available. This instance runs 1.2.0."
      )
    ).toBeInTheDocument();
  });
});
