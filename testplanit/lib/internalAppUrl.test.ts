import { describe, expect, it } from "vitest";
import { internalAppUrl } from "./internalAppUrl";

describe("internalAppUrl", () => {
  it("prefers an explicit INTERNAL_APP_URL", () => {
    expect(
      internalAppUrl({
        INTERNAL_APP_URL: "http://app.internal:8080/",
        PORT: "3000",
        HOSTNAME: "abc123",
        NEXTAUTH_URL: "https://tpi.example.com",
      })
    ).toBe("http://app.internal:8080");
  });

  it("uses the container hostname the standalone server binds to", () => {
    expect(
      internalAppUrl({
        PORT: "3000",
        HOSTNAME: "f51b601954d0",
        NEXTAUTH_URL: "http://localhost:3100",
      })
    ).toBe("http://f51b601954d0:3000");
  });

  it("uses loopback when the server binds every interface", () => {
    expect(internalAppUrl({ PORT: "3000", HOSTNAME: "0.0.0.0" })).toBe(
      "http://127.0.0.1:3000"
    );
    expect(internalAppUrl({ PORT: "4000" })).toBe("http://127.0.0.1:4000");
  });

  it("falls back to NEXTAUTH_URL without a PORT", () => {
    expect(
      internalAppUrl({
        NEXTAUTH_URL: "http://localhost:3002/",
      })
    ).toBe("http://localhost:3002");
    expect(internalAppUrl({})).toBe("http://localhost:3000");
  });
});
