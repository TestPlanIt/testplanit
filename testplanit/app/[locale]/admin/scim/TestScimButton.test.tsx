import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { TestScimButton } from "./TestScimButton";

// Mock the server action — every test controls the return.
const mockTestScimProbeAction = vi.fn();
vi.mock("~/app/actions/scimTokenActions", () => ({
  testScimProbeAction: (...args: unknown[]) =>
    mockTestScimProbeAction(...args),
}));

// Per-file next-intl override. The global vitest.setup.tsx mock does not
// know the admin.scim.probe.* templates, so its fallback path emits the
// literal key without substituting {status}/{reason}. We override here so
// the OK/FAIL banner assertions can compare against the real interpolated
// strings.
vi.mock("next-intl", () => {
  const dict: Record<string, string> = {
    "admin.scim.probe.button": "Test SCIM",
    "admin.scim.probe.testing": "Testing…",
    "admin.scim.probe.okBanner":
      "HTTP {status} — token works against /scim/v2/Users.",
    "admin.scim.probe.failBanner": "HTTP {status} — {reason}",
    "admin.scim.probe.networkError":
      "Couldn't reach the SCIM endpoint. Retry.",
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
});

function renderButton(tokenId = "tok-test-1") {
  return {
    user: userEvent.setup(),
    ...render(<TestScimButton tokenId={tokenId} />),
  };
}

describe("TestScimButton", () => {
  test("renders idle Button with Test SCIM label", () => {
    renderButton();
    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Test SCIM");
  });

  test("pending state: button disabled + label flips to testing while action runs", async () => {
    // Promise we control — never resolves until we release.
    let release: (
      v: { ok: boolean; status: number; reason?: string }
    ) => void = () => {};
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
      const btn = screen.getByRole("button");
      expect(btn).toBeDisabled();
      expect(btn).toHaveTextContent("Testing…");
    });

    // Let it resolve so React state cleans up before test exits.
    release({ ok: true, status: 200 });
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeEnabled();
    });
  });

  test("OK banner: role=status alert with HTTP 200 in copy", async () => {
    mockTestScimProbeAction.mockResolvedValueOnce({ ok: true, status: 200 });

    const { user } = renderButton();
    await user.click(screen.getByRole("button"));

    const okBanner = await screen.findByRole("status");
    expect(okBanner).toBeVisible();
    expect(okBanner).toHaveTextContent("200");
    // FAIL banner must NOT be present.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("FAIL banner: role=alert with HTTP 401 + reason in copy", async () => {
    mockTestScimProbeAction.mockResolvedValueOnce({
      ok: false,
      status: 401,
      reason: "Token rejected",
    });

    const { user } = renderButton();
    await user.click(screen.getByRole("button"));

    const failBanner = await screen.findByRole("alert");
    expect(failBanner).toBeVisible();
    expect(failBanner).toHaveTextContent("401");
    expect(failBanner).toHaveTextContent("Token rejected");
    // OK banner must NOT be present.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("no stacking: a second click replaces the prior banner instead of appending", async () => {
    mockTestScimProbeAction.mockResolvedValueOnce({ ok: true, status: 200 });

    const { user, container } = renderButton();
    await user.click(screen.getByRole("button"));

    const firstBanner = await screen.findByRole("status");
    expect(firstBanner).toBeVisible();

    // Second click — this time the probe fails.
    mockTestScimProbeAction.mockResolvedValueOnce({
      ok: false,
      status: 503,
      reason: "Service unreachable",
    });

    await user.click(screen.getByRole("button"));

    // After the second click resolves, the OK banner must be gone and the
    // FAIL banner must be the only banner in the component subtree.
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("503");
    });

    // Sanity: only one banner in the component subtree at any time.
    expect(
      within(container).queryAllByRole("status").length +
        within(container).queryAllByRole("alert").length
    ).toBe(1);
  });
});
