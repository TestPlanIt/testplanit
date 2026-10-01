import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDbUserFindFirst } = vi.hoisted(() => ({
  mockDbUserFindFirst: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    user: {
      findFirst: (...args: any[]) => mockDbUserFindFirst(...args),
    },
  },
}));

import { GET } from "./route";

describe("GET /api/admin-contact", () => {
  const original = process.env.SIGNIN_ADMIN_CONTACT;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SIGNIN_ADMIN_CONTACT;
    mockDbUserFindFirst.mockResolvedValue({ email: "admin@example.com" });
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SIGNIN_ADMIN_CONTACT;
    else process.env.SIGNIN_ADMIN_CONTACT = original;
  });

  it("returns the admin email when SIGNIN_ADMIN_CONTACT is unset", async () => {
    const res = await GET();

    expect(await res.json()).toEqual({
      enabled: true,
      email: "admin@example.com",
    });
  });

  it("stays enabled for any value other than false", async () => {
    process.env.SIGNIN_ADMIN_CONTACT = "true";

    const res = await GET();

    expect(await res.json()).toEqual({
      enabled: true,
      email: "admin@example.com",
    });
  });

  it.each(["false", "FALSE"])(
    "withholds the email and skips the lookup when set to %s",
    async (value) => {
      process.env.SIGNIN_ADMIN_CONTACT = value;

      const res = await GET();

      expect(await res.json()).toEqual({ enabled: false, email: null });
      expect(mockDbUserFindFirst).not.toHaveBeenCalled();
    }
  );

  it("returns a null email when no admin is found", async () => {
    mockDbUserFindFirst.mockResolvedValue(null);

    const res = await GET();

    expect(await res.json()).toEqual({ enabled: true, email: null });
  });

  it("returns a null email when the lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbUserFindFirst.mockRejectedValue(new Error("db down"));

    const res = await GET();

    expect(await res.json()).toEqual({ enabled: true, email: null });
  });
});
