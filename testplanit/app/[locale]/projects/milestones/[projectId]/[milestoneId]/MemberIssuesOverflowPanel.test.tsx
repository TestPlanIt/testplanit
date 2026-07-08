import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberIssuesOverflowPanel } from "./MemberIssuesOverflowPanel";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mockFetch);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe("MemberIssuesOverflowPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("always fetches the overflow route on mount", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ members: [], linkedCount: 0, cap: 1000, overflowTotal: 0 })
    );

    renderWithQueryClient(<MemberIssuesOverflowPanel milestoneId={42} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/milestones/42/members/overflow"
      );
    });
  });

  it("renders nothing when members is empty (self-gated, not on any table reachedCap signal)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ members: [], linkedCount: 5, cap: 1000, overflowTotal: 0 })
    );

    const { container } = renderWithQueryClient(
      <MemberIssuesOverflowPanel milestoneId={42} />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container.innerHTML).toBe("");
    });
  });

  it("renders the panel with the capped badge when linkedCount >= cap and overflowTotal > 0", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        members: [{ id: "ext-1", key: "PROJ-9", title: "Overflowed issue", status: "To Do" }],
        linkedCount: 1000,
        cap: 1000,
        overflowTotal: 12,
      })
    );

    renderWithQueryClient(<MemberIssuesOverflowPanel milestoneId={42} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("member-issues-overflow-capped-badge")
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("member-issues-overflow-drift-badge")
    ).not.toBeInTheDocument();
    expect(screen.getByText("PROJ-9", { exact: false })).toBeInTheDocument();
  });

  it("renders the plain drift badge when overflowTotal > 0 but linkedCount < cap", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        members: [{ id: "ext-2", key: "PROJ-10", title: "Drifted issue", status: "Done" }],
        linkedCount: 3,
        cap: 1000,
        overflowTotal: 1,
      })
    );

    renderWithQueryClient(<MemberIssuesOverflowPanel milestoneId={42} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("member-issues-overflow-drift-badge")
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("member-issues-overflow-capped-badge")
    ).not.toBeInTheDocument();
  });

  it("Import & link POSTs to the overflow route (server-validated reconciliation, not a direct client write)", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (!init) {
        return Promise.resolve(
          jsonResponse({
            members: [{ id: "ext-1", key: "PROJ-9", title: "Overflowed issue", status: "To Do" }],
            linkedCount: 1000,
            cap: 1000,
            overflowTotal: 12,
          })
        );
      }
      return Promise.resolve(jsonResponse({ success: true }));
    });

    renderWithQueryClient(<MemberIssuesOverflowPanel milestoneId={42} />);

    const importButton = await screen.findByTestId(
      "member-issues-overflow-import-button"
    );
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/milestones/42/members/overflow",
        { method: "POST" }
      );
    });
  });
});
