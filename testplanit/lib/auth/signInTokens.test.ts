// @vitest-environment node
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it } from "vitest";
import {
  signSignInToken,
  verifySignInToken,
  type SignInTokenPurpose,
} from "./signInTokens";

const SECRET = "test-secret-key-at-least-32-chars-long";
const PURPOSES: SignInTokenPurpose[] = [
  "saml-complete",
  "saml-relay",
  "two-factor-pending",
  "two-factor-setup",
];
const OTHER_PURPOSE_PAIRS = PURPOSES.flatMap((minted) =>
  PURPOSES.filter((expected) => expected !== minted).map(
    (expected) => [minted, expected] as const
  )
);

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
});

describe("sign-in tokens", () => {
  it.each(PURPOSES)("accepts a %s token for its own purpose", (purpose) => {
    const token = signSignInToken(
      purpose,
      { userId: "user-1" },
      { expiresIn: "5m" }
    );

    expect(verifySignInToken(purpose, token)).toMatchObject({
      userId: "user-1",
    });
  });

  it.each(OTHER_PURPOSE_PAIRS)(
    "refuses a %s token where a %s token is expected",
    (minted, expected) => {
      const token = signSignInToken(
        minted,
        { userId: "user-1" },
        { expiresIn: "5m" }
      );

      expect(verifySignInToken(expected, token)).toBeNull();
    }
  );

  it("refuses a token that names no purpose", () => {
    const unlabelled = jwt.sign({ userId: "user-1" }, SECRET, {
      expiresIn: "5m",
    });

    for (const purpose of PURPOSES) {
      expect(verifySignInToken(purpose, unlabelled)).toBeNull();
    }
  });

  it("refuses an expired token", () => {
    const token = signSignInToken(
      "two-factor-pending",
      { userId: "user-1" },
      { expiresIn: -10 }
    );

    expect(verifySignInToken("two-factor-pending", token)).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = jwt.sign({ userId: "user-1" }, "another-secret-entirely", {
      audience: "saml-complete",
      expiresIn: "5m",
    });

    expect(verifySignInToken("saml-complete", token)).toBeNull();
  });

  it("refuses a token signed with another algorithm", () => {
    const token = jwt.sign({ userId: "user-1" }, SECRET, {
      algorithm: "HS512",
      audience: "saml-complete",
      expiresIn: "5m",
    });

    expect(verifySignInToken("saml-complete", token)).toBeNull();
  });

  it("carries the token id it is given", () => {
    const token = signSignInToken(
      "saml-complete",
      { userId: "user-1" },
      { expiresIn: "2m", jwtid: "abc123" }
    );

    expect(verifySignInToken("saml-complete", token)?.jti).toBe("abc123");
  });

  it("refuses everything when no secret is configured", () => {
    const token = signSignInToken(
      "saml-complete",
      { userId: "user-1" },
      { expiresIn: "5m" }
    );
    delete process.env.NEXTAUTH_SECRET;

    expect(verifySignInToken("saml-complete", token)).toBeNull();
  });
});
