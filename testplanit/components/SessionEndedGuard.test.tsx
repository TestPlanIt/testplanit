import { render } from "@testing-library/react";
import { useSession } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
let mockPathname = "/projects";

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => mockPathname,
}));

import { SessionEndedGuard } from "./SessionEndedGuard";

const mockUseSession = vi.mocked(useSession);

function setStatus(status: "loading" | "authenticated" | "unauthenticated") {
  mockUseSession.mockReturnValue({
    status,
    data: status === "authenticated" ? ({ user: { id: "u1" } } as never) : null,
    update: vi.fn(),
  } as never);
}

describe("SessionEndedGuard", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPathname = "/projects";
  });

  it("sends an unauthenticated browser on a protected page to sign-in with a reason", () => {
    setStatus("unauthenticated");
    render(<SessionEndedGuard />);
    expect(mockReplace).toHaveBeenCalledWith("/signin?error=SessionEnded");
  });

  it("does nothing on a public page", () => {
    mockPathname = "/signin";
    setStatus("unauthenticated");
    render(<SessionEndedGuard />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does nothing while the session is loading", () => {
    setStatus("loading");
    render(<SessionEndedGuard />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does nothing for an authenticated session", () => {
    setStatus("authenticated");
    render(<SessionEndedGuard />);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
