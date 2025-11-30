import { describe, it, expect } from "vitest";
import { isAdmin, isProjectAdmin } from "./permissions";
import { Session } from "next-auth";

describe("permissions", () => {
  describe("isAdmin", () => {
    it("should return true for ADMIN access", () => {
      const session = {
        user: { access: "ADMIN" },
      } as Session;
      expect(isAdmin(session)).toBe(true);
    });

    it("should return false for PROJECTADMIN access", () => {
      const session = {
        user: { access: "PROJECTADMIN" },
      } as Session;
      expect(isAdmin(session)).toBe(false);
    });

    it("should return false for USER access", () => {
      const session = {
        user: { access: "USER" },
      } as Session;
      expect(isAdmin(session)).toBe(false);
    });

    it("should return false for null session", () => {
      expect(isAdmin(null)).toBe(false);
    });

    it("should return false when user is undefined", () => {
      const session = {} as Session;
      expect(isAdmin(session)).toBe(false);
    });

    it("should return false when access is undefined", () => {
      const session = {
        user: {},
      } as Session;
      expect(isAdmin(session)).toBe(false);
    });
  });

  describe("isProjectAdmin", () => {
    it("should return true for ADMIN access", () => {
      const session = {
        user: { access: "ADMIN" },
      } as Session;
      expect(isProjectAdmin(session)).toBe(true);
    });

    it("should return true for PROJECTADMIN access", () => {
      const session = {
        user: { access: "PROJECTADMIN" },
      } as Session;
      expect(isProjectAdmin(session)).toBe(true);
    });

    it("should return false for USER access", () => {
      const session = {
        user: { access: "USER" },
      } as Session;
      expect(isProjectAdmin(session)).toBe(false);
    });

    it("should return false for null session", () => {
      expect(isProjectAdmin(null)).toBe(false);
    });

    it("should return false when user is undefined", () => {
      const session = {} as Session;
      expect(isProjectAdmin(session)).toBe(false);
    });

    it("should return false when access is undefined", () => {
      const session = {
        user: {},
      } as Session;
      expect(isProjectAdmin(session)).toBe(false);
    });
  });
});
