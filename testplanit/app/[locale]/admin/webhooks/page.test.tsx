import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockNotFound = vi.fn();
vi.mock("next/navigation", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/navigation")>();
  return {
    ...original,
    notFound: (...args: unknown[]) => {
      mockNotFound(...args);
      throw new Error("NEXT_NOT_FOUND");
    },
    useSearchParams: () => new URLSearchParams(""),
  };
});

vi.mock("~/lib/navigation", () => ({
  usePathname: () => "/en-US/admin/webhooks",
  useRouter: () => ({ replace: vi.fn() }),
}));

type SessionLike = { user: { id: string; access: string } } | null;
let currentSession: SessionLike = {
  user: { id: "user-1", access: "ADMIN" },
};
let currentSessionStatus: "loading" | "authenticated" | "unauthenticated" =
  "authenticated";

// useRequireAuth returns { session, isLoading, isAuthenticated }.
vi.mock("~/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: currentSession,
    isLoading: currentSessionStatus === "loading",
    isAuthenticated: currentSessionStatus === "authenticated",
  }),
}));

// Stub the two heavy children — they have their own tests + run live data
// fetches that aren't relevant to the page's gate / tab structure contract.
vi.mock(
  "~/app/[locale]/projects/settings/[projectId]/webhooks/webhook-outbound-form",
  () => ({
    WebhookOutboundForm: ({ projectId }: { projectId: number }) => (
      <div data-testid="webhook-outbound-form-stub">
        outbound:{projectId}
      </div>
    ),
  })
);
vi.mock(
  "~/app/[locale]/projects/settings/[projectId]/webhooks/webhook-deliveries-tab",
  () => ({
    WebhookDeliveriesTab: ({ projectId }: { projectId: number }) => (
      <div data-testid="webhook-deliveries-tab-stub">
        deliveries:{projectId}
      </div>
    ),
  })
);

import AdminWebhooksPage from "./page";

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("AdminWebhooksPage (system-level outbound webhooks)", () => {
  beforeEach(() => {
    mockNotFound.mockReset();
    currentSession = { user: { id: "user-1", access: "ADMIN" } };
    currentSessionStatus = "authenticated";
  });

  it("notFound() for non-ADMIN users (PROJECTADMIN, USER, ...)", () => {
    currentSession = { user: { id: "user-2", access: "PROJECTADMIN" } };
    expect(() => render(<AdminWebhooksPage />)).toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("notFound() for USER access", () => {
    currentSession = { user: { id: "user-3", access: "USER" } };
    expect(() => render(<AdminWebhooksPage />)).toThrow("NEXT_NOT_FOUND");
  });

  it("renders for ADMIN with both child forms scoped to SYSTEM_PROJECT_ID (-1)", () => {
    render(<AdminWebhooksPage />);
    // Outbound tab is the default — only its stub renders eagerly.
    expect(
      screen.getByTestId("webhook-outbound-form-stub")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-outbound-form-stub").textContent
    ).toContain("outbound:-1");
  });

  it("renders no Inbound tab — system events have no inbound counterpart", () => {
    render(<AdminWebhooksPage />);
    expect(screen.queryByTestId("system-webhooks-tab-inbound")).toBeNull();
    expect(screen.getByTestId("system-webhooks-tab-outbound")).toBeInTheDocument();
    expect(screen.getByTestId("system-webhooks-tab-deliveries")).toBeInTheDocument();
  });
});
