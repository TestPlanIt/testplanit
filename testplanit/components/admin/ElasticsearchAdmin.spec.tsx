import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ElasticsearchAdmin } from "./ElasticsearchAdmin";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

const connectedStatus = {
  available: true,
  health: "green",
  numberOfNodes: 3,
  indices: [
    { name: "test-idx", docs: 1000, size: "5mb", health: "green" },
  ],
};

const disconnectedStatus = {
  available: false,
  message: "Failed to connect",
};

function makeStatusFetch(statusData: any, settingsData?: any) {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes("/api/admin/elasticsearch/reindex") && !String(url).includes("/reindex/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(statusData),
      });
    }
    if (String(url).includes("/api/admin/elasticsearch/settings")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(settingsData ?? { numberOfReplicas: 1 }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ElasticsearchAdmin", () => {
  test("shows loading indicator while fetching status", () => {
    // Make fetch pend forever
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ElasticsearchAdmin />);

    // Should show checking text while loading (loading=true and status=null)
    expect(screen.getByText("admin.elasticsearch.status.checking")).toBeInTheDocument();
  });

  test("renders connected state with GREEN badge and index info", async () => {
    global.fetch = makeStatusFetch(connectedStatus);
    render(<ElasticsearchAdmin />);

    await waitFor(() => {
      expect(screen.getByText("admin.integrations.oauth.connected")).toBeInTheDocument();
    });

    // Health badge shows GREEN (toUpperCase) — may appear multiple times (status + index)
    expect(screen.getAllByText("GREEN").length).toBeGreaterThan(0);

    // Number of nodes
    expect(screen.getByText("3")).toBeInTheDocument();

    // Index name
    expect(screen.getByText("test-idx")).toBeInTheDocument();
  });

  test("renders disconnected state with message and disabled reindex button", async () => {
    global.fetch = makeStatusFetch(disconnectedStatus);
    render(<ElasticsearchAdmin />);

    await waitFor(() => {
      expect(screen.getByText("admin.elasticsearch.status.disconnected")).toBeInTheDocument();
    });

    // Disconnected message
    expect(screen.getByText("Failed to connect")).toBeInTheDocument();

    // Reindex button should be disabled when not available
    // Find the Start Reindex button (contains reindex.button.start translation)
    const reindexButton = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("admin.elasticsearch.reindex.button.start"));
    expect(reindexButton).toBeDefined();
    expect(reindexButton).toBeDisabled();
  });

  test("hides settings card in multi-tenant mode", async () => {
    global.fetch = makeStatusFetch(connectedStatus);
    render(<ElasticsearchAdmin isMultiTenantMode={true} />);

    await waitFor(() => {
      expect(screen.getByText("admin.integrations.oauth.connected")).toBeInTheDocument();
    });

    // The replica input should NOT be present in multi-tenant mode
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  test("shows settings card with replica input in single-tenant mode", async () => {
    global.fetch = makeStatusFetch(connectedStatus, { numberOfReplicas: 1 });
    render(<ElasticsearchAdmin isMultiTenantMode={false} />);

    await waitFor(() => {
      expect(screen.getByText("admin.integrations.oauth.connected")).toBeInTheDocument();
    });

    // Replica input (number) should be present
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  test("clicking reindex button triggers POST to reindex endpoint", async () => {
    global.fetch = makeStatusFetch(connectedStatus);
    render(<ElasticsearchAdmin />);

    await waitFor(() => {
      expect(screen.getByText("admin.integrations.oauth.connected")).toBeInTheDocument();
    });

    // Set up fetch to capture the POST
    const postFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: "job-123" }),
      });
    global.fetch = postFetch;

    const reindexButton = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("admin.elasticsearch.reindex.button.start"));
    expect(reindexButton).toBeDefined();
    expect(reindexButton).not.toBeDisabled();

    fireEvent.click(reindexButton!);

    await waitFor(() => {
      expect(postFetch).toHaveBeenCalledWith(
        "/api/admin/elasticsearch/reindex",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"entityType":"all"'),
        })
      );
    });
  });

  test("renders index health badges for each index", async () => {
    global.fetch = makeStatusFetch({
      ...connectedStatus,
      indices: [
        { name: "cases-idx", docs: 500, size: "2mb", health: "green" },
        { name: "runs-idx", docs: 200, size: "1mb", health: "yellow" },
      ],
    });
    render(<ElasticsearchAdmin />);

    await waitFor(() => {
      expect(screen.getByText("cases-idx")).toBeInTheDocument();
    });

    expect(screen.getByText("runs-idx")).toBeInTheDocument();
    expect(screen.getAllByText("GREEN").length).toBeGreaterThan(0);
    expect(screen.getByText("YELLOW")).toBeInTheDocument();
  });

  test("renders reindex warning alert", async () => {
    global.fetch = makeStatusFetch(connectedStatus);
    render(<ElasticsearchAdmin />);

    await waitFor(() => {
      expect(screen.getByText("admin.elasticsearch.reindex.warning.title")).toBeInTheDocument();
    });
  });
});
