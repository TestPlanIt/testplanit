import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { TestScimButton } from "./TestScimButton";

// Mock the server action — every test controls the return.
const mockTestScimProbeAction = vi.fn();
vi.mock("~/app/actions/scimTokenActions", () => ({
  testScimProbeAction: (...args: unknown[]) => mockTestScimProbeAction(...args),
}));

// Mock sonner toast — assertions inspect the spy directly.
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Per-file next-intl override. The global vitest.setup.tsx mock does not
// know the admin.scim.probe.* templates, so its fallback path emits the
// literal key without substituting {status}/{reason}. We override here so
// the OK/FAIL toast assertions can compare against the real interpolated
// strings.
vi.mock("next-intl", () => {
  const dict: Record<string, string> = {
    "admin.scim.probe.button": "Test SCIM",
    "admin.scim.probe.testing": "Testing…",
    "admin.scim.probe.okBanner":
      "HTTP {status} — token works against /api/scim/v2/Users.",
    "admin.scim.probe.failBanner": "HTTP {status} — {reason}",
    "admin.scim.probe.networkError": "Couldn't reach the SCIM endpoint. Retry.",
  };
  return {
    useTranslations: (namespace?: string) => {
      return (key: string, params?: Record<string, unknown>) => {
        const fullKey = namespace ? `${namespace}.${key}` : key;
        let message = dict[fullKey] ?? fullKey;
        if (params) {
          for (const [pk, pv] of Object.entries(params)) {
            message = message.replace(`{${pk}}`, String(pv));
          }
        }
        return message;
      };
    },
    useLocale: () => "en",
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTestScimProbeAction.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
});

function renderButton(tokenId = "tok-test-1") {
  return {
    user: userEvent.setup(),
    ...render(<TestScimButton tokenId={tokenId} />),
  };
}

describe("TestScimButton", () => {
  test("renders icon-only button with accessible Test SCIM label", () => {
    renderButton();
    const button = screen.getByRole("button", { name: /Test SCIM/i });
    expect(button).toBeEnabled();
    // The visible label is screen-reader-only — the visible content is the
    // Activity icon. We assert via accessible name (sr-only span).
    expect(button).toHaveAccessibleName(/Test SCIM/i);
  });

  test("pending state: button disabled while action runs", async () => {
    // Promise we control — never resolves until we release.
    let release: (v: {
      ok: boolean;
      status: number;
      reason?: string;
    }) => void = () => {};
    const pendingPromise = new Promise<{
      ok: boolean;
      status: number;
      reason?: string;
    }>((resolve) => {
      release = resolve;
    });
    mockTestScimProbeAction.mockReturnValueOnce(pendingPromise);

    const { user } = renderButton();

    await user.click(screen.getByRole("button"));

    // Wait for pending state to stabilize after click.
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
    });

    // Let it resolve so React state cleans up before test exits.
    release({ ok: true, status: 200 });
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeEnabled();
    });
  });

  test("OK result: fires toast.success with HTTP 200 in description", async () => {
    mockTestScimProbeAction.mockResolvedValueOnce({ ok: true, status: 200 });

    const { user } = renderButton();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    });
    const [title, opts] = mockToastSuccess.mock.calls[0]!;
    expect(title).toBe("Test SCIM");
    expect((opts as { description: string }).description).toContain("200");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  test("FAIL result: fires toast.error with HTTP 401 + reason in description", async () => {
    mockTestScimProbeAction.mockResolvedValueOnce({
      ok: false,
      status: 401,
      reason: "Token rejected",
    });

    const { user } = renderButton();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });
    const [title, opts] = mockToastError.mock.calls[0]!;
    expect(title).toBe("Test SCIM");
    const description = (opts as { description: string }).description;
    expect(description).toContain("401");
    expect(description).toContain("Token rejected");
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  test("network error: fires toast.error with the thrown message", async () => {
    mockTestScimProbeAction.mockRejectedValueOnce(
      new Error("fetch failed: ECONNREFUSED")
    );

    const { user } = renderButton();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });
    const [, opts] = mockToastError.mock.calls[0]!;
    expect((opts as { description: string }).description).toContain(
      "ECONNREFUSED"
    );
  });

  test("second click replaces the prior result with a fresh toast", async () => {
    mockTestScimProbeAction.mockResolvedValueOnce({ ok: true, status: 200 });

    const { user } = renderButton();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    });

    // Second click — this time the probe fails.
    mockTestScimProbeAction.mockResolvedValueOnce({
      ok: false,
      status: 503,
      reason: "Service unreachable",
    });

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
    });
    // Each click emits exactly one toast — no stacking.
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledTimes(1);
  });
});
