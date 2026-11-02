import { describe, expect, it } from "vitest";
import { isPublicPath } from "./publicRoutes";

describe("isPublicPath", () => {
  it.each([
    "/signin",
    "/signup",
    "/share/abc",
    "/passwordless/x",
    "/verify-email",
  ])("treats %s as public", (path) => expect(isPublicPath(path)).toBe(true));

  it.each([
    "/",
    "/projects",
    "/users/profile/u1",
    "/signinx",
    "/account/link-sso",
  ])("treats %s as protected", (path) =>
    expect(isPublicPath(path)).toBe(false)
  );
});
