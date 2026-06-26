import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- vi.hoisted for variables used in vi.mock factories ---
const mockUseTranslations = vi.hoisted(() => vi.fn());
const mockUseFindManyApiToken = vi.hoisted(() => vi.fn());
const mockUseDeleteApiToken = vi.hoisted(() => vi.fn());
const mockUseQueryClient = vi.hoisted(() => vi.fn());

// --- Mocks ---
// Override the global next-intl mock from vitest.setup.tsx so the namespace
// 'users.profile.apiTokens' resolves to last-segment passthroughs (e.g.
// `t("readOnlyLabel")` returns the literal string "readOnlyLabel"). This
// keeps the test selectors readable and decoupled from the en-US.json copy.
vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    apiToken: {
      useFindMany: mockUseFindManyApiToken,
      useDelete: mockUseDeleteApiToken,
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: mockUseQueryClient,
}));

// DateFormatter has heavy date-fns dependencies; stub to a stable span.
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: any) => (
    <span data-testid="date-formatter">{String(date)}</span>
  ),
}));

import { ApiTokenSettings } from "./ApiTokenSettings";

const mockFetch = vi.fn();

function makeTokens(
  rows: Array<{ id: string; name: string; scopes: string[] }>
) {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokenPrefix: "tpi_abc",
    createdAt: new Date("2026-01-01"),
    lastUsedAt: null,
    expiresAt: null,
    isActive: true,
    scopes: r.scopes,
  }));
}

beforeEach(() => {
  // Translations: last-segment passthrough so getByLabelText("readOnlyLabel")
  // matches what the production component renders.
  mockUseTranslations.mockReturnValue((key: string, _opts?: any) => {
    const parts = key.split(".");
    return parts[parts.length - 1];
  });

  mockUseFindManyApiToken.mockReturnValue({
    data: [],
    refetch: vi.fn(),
  });

  mockUseDeleteApiToken.mockReturnValue({
    mutateAsync: vi.fn(),
  });

  mockUseQueryClient.mockReturnValue({
    invalidateQueries: vi.fn(),
  });

  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "tok_new",
      name: "Test",
      token: "tpi_secret",
      tokenPrefix: "tpi_abc",
      createdAt: new Date().toISOString(),
      expiresAt: null,
    }),
  });
  global.fetch = mockFetch as any;
});

afterEach(() => {
  vi.clearAllMocks();
});

async function openCreateDialog() {
  // Open the create dialog by clicking the "create" button rendered by the
  // owner view. The translation mock returns "create" as the visible label.
  const button = screen.getByRole("button", { name: "create" });
  fireEvent.click(button);
}

async function fillNameAndSubmit(name = "My Token") {
  const nameInput = screen.getByLabelText("nameLabel");
  fireEvent.change(nameInput, { target: { value: name } });
  const buttons = screen.getAllByRole("button", { name: "create" });
  // Two "create" buttons exist when dialog is open: the section-header one
  // and the dialog-footer submit. The latter is what we want.
  const submit = buttons[buttons.length - 1];
  fireEvent.click(submit);
  // wait a microtask for the async submit handler to run
  await Promise.resolve();
  await Promise.resolve();
}

describe("ApiTokenSettings — read-only and agent-token UI", () => {
  describe("create dialog checkboxes", () => {
    it("renders both checkboxes when create dialog opens", async () => {
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      await openCreateDialog();

      const readOnly = screen.getByLabelText(
        "readOnlyLabel"
      ) as HTMLButtonElement;
      const agent = screen.getByLabelText(
        "agentTokenLabel"
      ) as HTMLButtonElement;
      expect(readOnly).toBeDefined();
      expect(agent).toBeDefined();
      // Radix Checkbox renders as a button with aria-checked
      expect(readOnly.getAttribute("aria-checked")).toBe("false");
      expect(agent.getAttribute("aria-checked")).toBe("false");
    });

    it("toggles checkboxes independently", async () => {
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      await openCreateDialog();

      const readOnly = screen.getByLabelText("readOnlyLabel");
      const agent = screen.getByLabelText("agentTokenLabel");
      fireEvent.click(readOnly);
      expect(readOnly.getAttribute("aria-checked")).toBe("true");
      expect(agent.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(agent);
      expect(readOnly.getAttribute("aria-checked")).toBe("true");
      expect(agent.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(readOnly);
      expect(readOnly.getAttribute("aria-checked")).toBe("false");
      expect(agent.getAttribute("aria-checked")).toBe("true");
    });

    it("submits scopes: ['mode:read'] when only read-only is checked", async () => {
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      await openCreateDialog();
      fireEvent.click(screen.getByLabelText("readOnlyLabel"));
      await fillNameAndSubmit();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.scopes).toEqual(["mode:read"]);
    });

    it("submits scopes: ['client:mcp'] when only agent-token is checked", async () => {
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      await openCreateDialog();
      fireEvent.click(screen.getByLabelText("agentTokenLabel"));
      await fillNameAndSubmit();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.scopes).toEqual(["client:mcp"]);
    });

    it("submits scopes in deterministic order [mode:read, client:mcp] when both checked", async () => {
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      await openCreateDialog();
      // Click in REVERSE of build-up order to prove the build-up order is
      // canonical (read-only first, agent-token second), not click-order.
      fireEvent.click(screen.getByLabelText("agentTokenLabel"));
      fireEvent.click(screen.getByLabelText("readOnlyLabel"));
      await fillNameAndSubmit();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.scopes).toEqual(["mode:read", "client:mcp"]);
    });

    it("submits scopes: [] when neither checkbox is checked", async () => {
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      await openCreateDialog();
      await fillNameAndSubmit();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.scopes).toEqual([]);
    });

    it("resets both checkboxes to unchecked when dialog is closed and reopened", async () => {
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      await openCreateDialog();
      fireEvent.click(screen.getByLabelText("readOnlyLabel"));
      fireEvent.click(screen.getByLabelText("agentTokenLabel"));
      expect(
        screen.getByLabelText("readOnlyLabel").getAttribute("aria-checked")
      ).toBe("true");

      // Click cancel — the only `cancel` button on the page.
      fireEvent.click(screen.getByRole("button", { name: "cancel" }));

      // Reopen the dialog
      await openCreateDialog();
      expect(
        screen.getByLabelText("readOnlyLabel").getAttribute("aria-checked")
      ).toBe("false");
      expect(
        screen.getByLabelText("agentTokenLabel").getAttribute("aria-checked")
      ).toBe("false");
    });
  });

  describe("token row badges", () => {
    it("renders read-only badge for a token with scopes ['mode:read']", () => {
      mockUseFindManyApiToken.mockReturnValue({
        data: makeTokens([
          { id: "t1", name: "Read Token", scopes: ["mode:read"] },
        ]),
        refetch: vi.fn(),
      });
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      const row = screen.getByText("Read Token").closest("tr")!;
      expect(within(row).getByText("readOnlyBadge")).toBeDefined();
      expect(within(row).queryByText("agentTokenBadge")).toBeNull();
    });

    it("renders agent-token badge for a token with scopes ['client:mcp']", () => {
      mockUseFindManyApiToken.mockReturnValue({
        data: makeTokens([
          { id: "t1", name: "Agent Token", scopes: ["client:mcp"] },
        ]),
        refetch: vi.fn(),
      });
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      const row = screen.getByText("Agent Token").closest("tr")!;
      expect(within(row).getByText("agentTokenBadge")).toBeDefined();
      expect(within(row).queryByText("readOnlyBadge")).toBeNull();
    });

    it("renders both badges for a token with both scopes", () => {
      mockUseFindManyApiToken.mockReturnValue({
        data: makeTokens([
          {
            id: "t1",
            name: "Both Token",
            scopes: ["mode:read", "client:mcp"],
          },
        ]),
        refetch: vi.fn(),
      });
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      const row = screen.getByText("Both Token").closest("tr")!;
      expect(within(row).getByText("readOnlyBadge")).toBeDefined();
      expect(within(row).getByText("agentTokenBadge")).toBeDefined();
    });

    it("renders neither badge for a token with empty scopes", () => {
      mockUseFindManyApiToken.mockReturnValue({
        data: makeTokens([{ id: "t1", name: "Empty Token", scopes: [] }]),
        refetch: vi.fn(),
      });
      render(
        <ApiTokenSettings
          userId="user-123"
          isOwnProfile={true}
          isAdmin={false}
        />
      );
      const row = screen.getByText("Empty Token").closest("tr")!;
      expect(within(row).queryByText("readOnlyBadge")).toBeNull();
      expect(within(row).queryByText("agentTokenBadge")).toBeNull();
    });
  });
});
