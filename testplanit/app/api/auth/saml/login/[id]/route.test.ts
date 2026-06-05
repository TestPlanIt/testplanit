// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

vi.mock("~/lib/valkey", () => ({ default: null }));

import { GET } from "./route";

function makeReq(callbackUrl?: string) {
  const sp = new URLSearchParams();
  if (callbackUrl) sp.set("callbackUrl", callbackUrl);
  return {
    nextUrl: { searchParams: sp },
    headers: new Headers(),
    // In production (standalone server in k8s) request.url carries the internal
    // pod host — the original bug. The handler must not propagate it.
    url: "https://cint-prod-pod-xyz:3000/api/auth/saml/login/prov_123",
  } as any;
}

describe("GET /api/auth/saml/login/[id] — Bug 1: must not use the request host", () => {
  it("redirects to the public NEXTAUTH_URL origin, not the pod host", async () => {
    const res = await GET(makeReq("/projects"), {
      params: Promise.resolve({ id: "prov_123" }),
    });

    const location = res.headers.get("location")!;
    const url = new URL(location);

    expect(url.origin).toBe("https://app.example.com");
    expect(url.pathname).toBe("/api/auth/saml");
    expect(url.searchParams.get("provider")).toBe("prov_123");
    expect(url.searchParams.get("callbackUrl")).toBe("/projects");

    // Explicit guards against the reported regression.
    expect(location).not.toContain("cint-prod-pod-xyz");
    expect(location).not.toContain(":3000");
  });

  it("defaults callbackUrl to / when absent", async () => {
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: "p1" }),
    });
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("callbackUrl")).toBe("/");
  });
});
