import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  cspHeaderName,
  generateCspNonce,
  getCspMode,
} from "./contentSecurityPolicy";

const directive = (policy: string, name: string): string[] | undefined => {
  const entry = policy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);
  return entry?.slice(name.length).trim().split(/\s+/);
};

describe("getCspMode", () => {
  it("defaults to report-only", () => {
    expect(getCspMode({})).toBe("report-only");
    expect(getCspMode({ CSP_MODE: "" })).toBe("report-only");
    expect(getCspMode({ CSP_MODE: "nonsense" })).toBe("report-only");
  });

  it("reads enforce and off, ignoring case and whitespace", () => {
    expect(getCspMode({ CSP_MODE: "enforce" })).toBe("enforce");
    expect(getCspMode({ CSP_MODE: " Enforce " })).toBe("enforce");
    expect(getCspMode({ CSP_MODE: "OFF" })).toBe("off");
  });

  it("maps modes to header names", () => {
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report-only")).toBe(
      "Content-Security-Policy-Report-Only"
    );
  });
});

describe("generateCspNonce", () => {
  it("is 16 random bytes, base64 encoded, and different every time", () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe("buildContentSecurityPolicy", () => {
  const nonce = "abc123==";

  it("trusts only nonced scripts and what they load", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      env: {},
      isDevelopment: false,
    });
    expect(directive(policy, "script-src")).toEqual([
      "'self'",
      "'nonce-abc123=='",
      "'strict-dynamic'",
    ]);
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(directive(policy, "form-action")).toEqual(["'self'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'self'"]);
    expect(directive(policy, "report-uri")).toEqual(["/api/csp-report"]);
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("ws:");
  });

  it("allows inline styles, since Tailwind and the editor set them", () => {
    const policy = buildContentSecurityPolicy({ nonce, env: {} });
    expect(directive(policy, "style-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
    ]);
  });

  it("adds the storage origins the browser fetches files from", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      env: {
        AWS_PUBLIC_ENDPOINT_URL: "https://files.example.com/",
        AWS_ENDPOINT_URL: "http://minio:9000",
      },
      isDevelopment: false,
    });
    for (const name of ["connect-src", "frame-src"]) {
      expect(directive(policy, name)).toEqual(
        expect.arrayContaining([
          "https://files.example.com",
          "http://minio:9000",
        ])
      );
    }
  });

  it("falls back to the bucket's AWS hostnames when no endpoint is set", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      env: { AWS_BUCKET_NAME: "tpi-files", AWS_REGION: "eu-west-1" },
      isDevelopment: false,
    });
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://tpi-files.s3.amazonaws.com",
      "https://tpi-files.s3.eu-west-1.amazonaws.com",
    ]);
    expect(
      directive(
        buildContentSecurityPolicy({ nonce, env: {}, isDevelopment: false }),
        "connect-src"
      )
    ).toEqual(["'self'"]);
  });

  it("lets images and media come from any web host", () => {
    const policy = buildContentSecurityPolicy({ nonce, env: {} });
    const anyHost = ["'self'", "data:", "blob:", "https:", "http:"];
    expect(directive(policy, "img-src")).toEqual(anyHost);
    expect(directive(policy, "media-src")).toEqual(anyHost);
  });

  it("lets the feedback survey be framed", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      env: { FEEDBACK_SURVEY_URL: "https://surveys.example.com/s/abc?x=1" },
      isDevelopment: false,
    });
    expect(directive(policy, "frame-src")).toEqual([
      "'self'",
      "blob:",
      "https://surveys.example.com",
    ]);
  });

  it("appends operator-listed origins and frame ancestors", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      env: {
        CSP_ALLOWED_ORIGINS:
          "https://cdn.example.com, https://viewer.example.com",
        CSP_FRAME_ANCESTORS: "'self' https://jira.example.com",
      },
      isDevelopment: false,
    });
    for (const name of ["connect-src", "frame-src"]) {
      expect(directive(policy, name)).toEqual(
        expect.arrayContaining([
          "https://cdn.example.com",
          "https://viewer.example.com",
        ])
      );
    }
    expect(directive(policy, "frame-ancestors")).toEqual([
      "'self'",
      "https://jira.example.com",
    ]);
  });

  it("ignores unparsable storage URLs and lists each origin once", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      env: {
        AWS_PUBLIC_ENDPOINT_URL: "not a url",
        AWS_ENDPOINT_URL: "https://s3.example.com",
        CSP_ALLOWED_ORIGINS: "https://s3.example.com",
      },
      isDevelopment: false,
    });
    const connect = directive(policy, "connect-src") ?? [];
    expect(connect.filter((s) => s === "https://s3.example.com")).toHaveLength(
      1
    );
    expect(policy).not.toContain("not a url");
  });

  it("lets the dev server eval and open its HMR socket", () => {
    const policy = buildContentSecurityPolicy({
      nonce,
      env: {},
      isDevelopment: true,
    });
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
    expect(directive(policy, "connect-src")).toEqual(
      expect.arrayContaining(["ws:", "wss:"])
    );
  });
});
