// @vitest-environment node
import { SAML } from "@node-saml/node-saml";
import { describe, expect, it, vi } from "vitest";

import { normalizeSamlCert, normalizeSamlCertForClient } from "./saml-cert";
import { createSAMLClient } from "./saml-provider";

vi.hoisted(() => {
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

// A valid base64 body of realistic length. node-saml only checks that the
// body is decodeable base64 when wrapping it as PEM, so this need not be a
// real DER certificate — the failure mode under test is purely about
// whitespace, not certificate content.
const CERT_BODY = Buffer.from("a".repeat(900)).toString("base64");
const CERT_BODY_2 = Buffer.from("b".repeat(900)).toString("base64");

function pem(body: string): string {
  const wrapped = body.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----\n`;
}

// The whitespace-mangled form: a PEM whose newlines were all collapsed to
// single spaces (markers and body on one line). This is exactly what broke
// the customer's Okta login.
function singleLineWithSpaces(body: string): string {
  const spacedBody = body.match(/.{1,64}/g)!.join(" ");
  return `-----BEGIN CERTIFICATE----- ${spacedBody} -----END CERTIFICATE-----`;
}

describe("normalizeSamlCert", () => {
  it("(a) recovers canonical PEM from a single-line PEM with spaces", () => {
    expect(normalizeSamlCert(singleLineWithSpaces(CERT_BODY))).toBe(
      pem(CERT_BODY)
    );
  });

  it("(b) leaves an already-canonical PEM unchanged and is idempotent", () => {
    const canonical = pem(CERT_BODY);
    expect(normalizeSamlCert(canonical)).toBe(canonical);

    const once = normalizeSamlCert(singleLineWithSpaces(CERT_BODY));
    expect(normalizeSamlCert(once)).toBe(once);
  });

  it("(c) wraps a raw base64 body (no headers) into canonical PEM", () => {
    expect(normalizeSamlCert(CERT_BODY)).toBe(pem(CERT_BODY));
  });

  it("(d) collapses a base64 body with embedded newlines into canonical PEM", () => {
    const withNewlines = CERT_BODY.match(/.{1,64}/g)!.join("\n");
    expect(normalizeSamlCert(withNewlines)).toBe(pem(CERT_BODY));
  });

  it("(e) returns genuinely non-base64 input unchanged (no throw)", () => {
    const garbage = "this is definitely not a certificate!!!";
    expect(normalizeSamlCert(garbage)).toBe(garbage);
    expect(normalizeSamlCert("")).toBe("");
  });

  it("normalizes each certificate in a concatenated chain", () => {
    const chain = pem(CERT_BODY) + pem(CERT_BODY_2);
    expect(normalizeSamlCert(chain)).toBe(pem(CERT_BODY) + pem(CERT_BODY_2));
    // Idempotent across the chain too.
    expect(normalizeSamlCert(normalizeSamlCert(chain))).toBe(
      normalizeSamlCert(chain)
    );
  });
});

describe("normalizeSamlCertForClient", () => {
  it("returns a single PEM string for one certificate", () => {
    expect(normalizeSamlCertForClient(singleLineWithSpaces(CERT_BODY))).toBe(
      pem(CERT_BODY)
    );
  });

  it("returns an array of PEM strings for a chain", () => {
    const chain = pem(CERT_BODY) + pem(CERT_BODY_2);
    expect(normalizeSamlCertForClient(chain)).toEqual([
      pem(CERT_BODY),
      pem(CERT_BODY_2),
    ]);
  });

  it("returns non-base64 input unchanged", () => {
    const garbage = "not a cert";
    expect(normalizeSamlCertForClient(garbage)).toBe(garbage);
  });
});

describe("createSAMLClient cert handling", () => {
  it("builds a client whose cert node-saml accepts, from the space-mangled form", async () => {
    const mangled = singleLineWithSpaces(CERT_BODY);

    const client = await createSAMLClient({
      name: "test",
      entryPoint: "https://idp.example.com/sso",
      issuer: "https://app.example.com",
      cert: mangled,
    });

    // getKeyInfosAsPem() runs the same node-saml code path
    // (keyInfoToPem) that threw "not in PEM format or in base64 format" on the
    // mangled input. It now resolves to a single canonical PEM.
    const pems = await (client as unknown as {
      getKeyInfosAsPem: () => Promise<string[]>;
    }).getKeyInfosAsPem();
    expect(pems).toHaveLength(1);
    expect(pems[0]).toContain("-----BEGIN CERTIFICATE-----");
    expect(pems[0]).toContain("-----END CERTIFICATE-----");

    // Negative control: node-saml rejects the un-normalized mangled cert,
    // confirming the normalization is what makes the client work.
    const raw = new SAML({
      callbackUrl: "https://app.example.com/api/auth/callback/saml",
      issuer: "https://app.example.com",
      idpCert: mangled,
    });
    await expect(
      (raw as unknown as {
        getKeyInfosAsPem: () => Promise<string[]>;
      }).getKeyInfosAsPem()
    ).rejects.toThrow(/PEM format or in base64 format/);
  });
});
