import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheck, mockUseSession, mockUsePathname } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockUseSession: vi.fn(),
  mockUsePathname: vi.fn(),
}));

vi.mock("~/app/actions/upgrade-notifications", () => ({
  checkUpgradeNotifications: mockCheck,
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

vi.mock("~/lib/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

import { UpgradeNotificationChecker } from "./UpgradeNotificationChecker";

const signedIn = {
  status: "authenticated",
  data: { user: { id: "user-1" } },
};

describe("UpgradeNotificationChecker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheck.mockResolvedValue(undefined);
    mockUseSession.mockReturnValue(signedIn);
    mockUsePathname.mockReturnValue("/projects");
  });

  it("checks once for a signed-in session", () => {
    const { rerender } = render(<UpgradeNotificationChecker />);
    mockUsePathname.mockReturnValue("/projects/overview/1");
    rerender(<UpgradeNotificationChecker />);

    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("does not check without a session", () => {
    mockUseSession.mockReturnValue({ status: "unauthenticated", data: null });
    render(<UpgradeNotificationChecker />);

    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("waits on a sign-in step page and checks once the session reaches the app", () => {
    mockUsePathname.mockReturnValue("/auth/two-factor-verify");
    const { rerender } = render(<UpgradeNotificationChecker />);
    expect(mockCheck).not.toHaveBeenCalled();

    mockUsePathname.mockReturnValue("/");
    rerender(<UpgradeNotificationChecker />);

    expect(mockCheck).toHaveBeenCalledTimes(1);
  });
});
