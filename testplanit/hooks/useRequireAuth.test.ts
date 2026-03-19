import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useRequireAuth } from "./useRequireAuth";

// --- Mocks ---

// Hoist mock refs so they can be used in vi.mock factory
const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}));

const { mockSessionStatus, mockSessionData } = vi.hoisted(() => ({
  mockSessionStatus: { value: "loading" as "loading" | "authenticated" | "unauthenticated" },
  mockSessionData: { value: null as any },
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/dashboard",
  Link: ({ children }: { children: React.ReactNode }) => children,
  redirect: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: mockSessionData.value,
    status: mockSessionStatus.value,
  }),
}));

describe("useRequireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStatus.value = "loading";
    mockSessionData.value = null;
  });

  describe("loading state", () => {
    it("should return isLoading=true when status is 'loading'", () => {
      mockSessionStatus.value = "loading";
      mockSessionData.value = null;

      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.isLoading).toBe(true);
    });

    it("should not redirect when status is 'loading'", () => {
      mockSessionStatus.value = "loading";

      renderHook(() => useRequireAuth());

      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("should return isAuthenticated=false when loading", () => {
      mockSessionStatus.value = "loading";

      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.isAuthenticated).toBe(false);
    });

    it("should return session=null when loading", () => {
      mockSessionStatus.value = "loading";
      mockSessionData.value = null;

      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.session).toBeNull();
    });
  });

  describe("authenticated state", () => {
    const mockSession = {
      user: { id: "user-1", name: "Alice", email: "alice@example.com" },
      expires: "2099-01-01",
    };

    beforeEach(() => {
      mockSessionStatus.value = "authenticated";
      mockSessionData.value = mockSession;
    });

    it("should return isAuthenticated=true when authenticated", () => {
      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.isAuthenticated).toBe(true);
    });

    it("should return isLoading=false when authenticated", () => {
      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.isLoading).toBe(false);
    });

    it("should return the session data when authenticated", () => {
      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.session).toEqual(mockSession);
    });

    it("should not redirect when authenticated", () => {
      renderHook(() => useRequireAuth());

      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("should return the status as 'authenticated'", () => {
      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.status).toBe("authenticated");
    });
  });

  describe("unauthenticated state", () => {
    beforeEach(() => {
      mockSessionStatus.value = "unauthenticated";
      mockSessionData.value = null;
    });

    it("should redirect to /signin when unauthenticated", () => {
      renderHook(() => useRequireAuth());

      expect(mockRouterPush).toHaveBeenCalledWith("/signin");
    });

    it("should return isAuthenticated=false when unauthenticated", () => {
      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.isAuthenticated).toBe(false);
    });

    it("should return isLoading=false when unauthenticated", () => {
      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.isLoading).toBe(false);
    });

    it("should return session=null when unauthenticated", () => {
      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.session).toBeNull();
    });

    it("should return status as 'unauthenticated'", () => {
      const { result } = renderHook(() => useRequireAuth());

      expect(result.current.status).toBe("unauthenticated");
    });

    it("should call router.push only once for the redirect", () => {
      renderHook(() => useRequireAuth());

      expect(mockRouterPush).toHaveBeenCalledTimes(1);
    });
  });

  describe("return shape", () => {
    it("should expose session, status, isLoading, isAuthenticated", () => {
      mockSessionStatus.value = "loading";

      const { result } = renderHook(() => useRequireAuth());

      expect(result.current).toHaveProperty("session");
      expect(result.current).toHaveProperty("status");
      expect(result.current).toHaveProperty("isLoading");
      expect(result.current).toHaveProperty("isAuthenticated");
    });

    it("should return correct types for all fields", () => {
      mockSessionStatus.value = "loading";

      const { result } = renderHook(() => useRequireAuth());

      expect(typeof result.current.isLoading).toBe("boolean");
      expect(typeof result.current.isAuthenticated).toBe("boolean");
      expect(typeof result.current.status).toBe("string");
    });

    it("should update correctly when status transitions from loading to authenticated", () => {
      mockSessionStatus.value = "loading";
      mockSessionData.value = null;

      const { result, rerender } = renderHook(() => useRequireAuth());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isAuthenticated).toBe(false);

      // Simulate session resolved
      mockSessionStatus.value = "authenticated";
      mockSessionData.value = { user: { id: "user-1" }, expires: "2099-01-01" };

      rerender();

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it("should trigger redirect when status transitions from loading to unauthenticated", () => {
      mockSessionStatus.value = "loading";

      const { rerender } = renderHook(() => useRequireAuth());

      expect(mockRouterPush).not.toHaveBeenCalled();

      mockSessionStatus.value = "unauthenticated";
      mockSessionData.value = null;

      rerender();

      expect(mockRouterPush).toHaveBeenCalledWith("/signin");
    });
  });
});
