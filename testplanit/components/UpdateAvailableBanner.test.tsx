import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTesting, reportPossibleSkew } from "~/lib/deploymentSkew";
// Resolve against the real en-US.json rather than the hand-pasted subset in
// vitest.setup.tsx, so these assertions fail if the shipped copy changes.
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
    NextIntlClientProvider: ({ children }: any) => children,
    useTranslations: (namespace?: string) => (key: string) => {
      const full = namespace ? `${namespace}.${key}` : key;
      return get(full) ?? full;
    },
  };
});

import { UpdateAvailableBanner } from "./UpdateAvailableBanner";

const skew = () =>
  Object.assign(new Error('Server Action "abc" was not found on the server.'), {
    name: "UnrecognizedActionError",
  });

const originalLocation = window.location;

describe("UpdateAvailableBanner", () => {
  beforeEach(() => {
    _resetForTesting();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("renders nothing while the tab is current", () => {
    render(<UpdateAvailableBanner />);
    expect(
      screen.queryByTestId("update-available-banner")
    ).not.toBeInTheDocument();
  });

  it("appears on a skew error with the update message", () => {
    render(<UpdateAvailableBanner />);
    act(() => reportPossibleSkew(skew()));

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "TestPlanIt was updated. Refresh to keep working — unsaved changes on this page may be lost."
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeVisible();
  });

  it("reloads the page from the Refresh button", async () => {
    const user = userEvent.setup();
    render(<UpdateAvailableBanner />);
    act(() => reportPossibleSkew(skew()));

    await user.click(screen.getByTestId("update-available-reload"));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it("dismisses until the next skew error", async () => {
    const user = userEvent.setup();
    render(<UpdateAvailableBanner />);
    act(() => reportPossibleSkew(skew()));

    await user.click(screen.getByTestId("update-available-dismiss"));
    expect(
      screen.queryByTestId("update-available-banner")
    ).not.toBeInTheDocument();
    expect(window.location.reload).not.toHaveBeenCalled();

    act(() => reportPossibleSkew(skew()));
    expect(screen.getByTestId("update-available-banner")).toBeInTheDocument();
  });

  it("keeps its pointerdowns from reaching an open dialog's outside-click handler", () => {
    render(<UpdateAvailableBanner />);
    act(() => reportPossibleSkew(skew()));

    const outsideClick = vi.fn();
    document.addEventListener("pointerdown", outsideClick);
    try {
      fireEvent.pointerDown(screen.getByTestId("update-available-dismiss"));
      expect(outsideClick).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", outsideClick);
    }
  });
});
