import { afterEach, describe, expect, it } from "vitest";

import { randomUuid } from "./randomUuid";

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const nativeRandomUUID = crypto.randomUUID;

/**
 * Chrome on an insecure origin does not define the method at all, so the
 * fallback has to survive the property being missing, not merely throwing.
 */
function simulateInsecureOrigin() {
  Object.defineProperty(crypto, "randomUUID", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(crypto, "randomUUID", {
    value: nativeRandomUUID,
    configurable: true,
    writable: true,
  });
});

describe("randomUuid", () => {
  it("returns a v4 UUID in a secure context", () => {
    expect(randomUuid()).toMatch(V4);
  });

  it("returns a v4 UUID when crypto.randomUUID is undefined", () => {
    simulateInsecureOrigin();
    expect(crypto.randomUUID).toBeUndefined();
    expect(randomUuid()).toMatch(V4);
  });

  it("does not throw on an insecure origin", () => {
    simulateInsecureOrigin();
    expect(() => randomUuid()).not.toThrow();
  });

  it("does not repeat itself on an insecure origin", () => {
    simulateInsecureOrigin();
    const ids = new Set(Array.from({ length: 1000 }, () => randomUuid()));
    expect(ids.size).toBe(1000);
  });
});
