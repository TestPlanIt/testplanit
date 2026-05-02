import { describe, it, expect } from "vitest";
import { tenantBroadcastChannel, userChannel } from "./channels";

describe("channels.userChannel", () => {
  it("returns notifications:tenant:<tenantId>:user:<userId>", () => {
    expect(userChannel("acme", "u_123")).toBe(
      "notifications:tenant:acme:user:u_123"
    );
  });

  it("throws when tenantId is empty", () => {
    expect(() => userChannel("", "u_123")).toThrow(/tenantId is required/);
  });

  it("throws when userId is empty", () => {
    expect(() => userChannel("acme", "")).toThrow(/userId is required/);
  });
});

describe("channels.tenantBroadcastChannel", () => {
  it("returns notifications:tenant:<tenantId>:broadcast", () => {
    expect(tenantBroadcastChannel("acme")).toBe(
      "notifications:tenant:acme:broadcast"
    );
  });

  it("throws when tenantId is empty", () => {
    expect(() => tenantBroadcastChannel("")).toThrow(/tenantId is required/);
  });
});
