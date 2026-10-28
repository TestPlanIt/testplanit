// @vitest-environment node
import { SAML } from "@node-saml/node-saml";
import { describe, expect, it, vi } from "vitest";

import { normalizeSamlCert, normalizeSamlCertForClient } from "./saml-cert";
import { createSAMLClient } from "./saml-provider";

vi.hoisted(() => {
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

// Real self-signed certificates — public material only, the keys were never
// kept — valid well past any plausible use of this test. They have to parse as
// X.509: node-saml hands the value to xml-crypto's `toPem()`, which reads the
// certificate rather than pattern-matching it, so a body that is merely
// decodeable base64 is rejected. The failure mode under test is whitespace
// mangling rather than certificate content, but the content must be genuine
// for node-saml to get as far as the whitespace.
const CERT_BODY = `
MIIDOTCCAiGgAwIBAgIUbQlkcFAVKONA0Y4hEPBYUfw97eEwDQYJKoZIhvcNAQEL
BQAwLDEqMCgGA1UEAwwhc2FtbC1maXh0dXJlLTEudGVzdHBsYW5pdC5pbnZhbGlk
MB4XDTI2MTAyODA0MjI0N1oXDTQ2MTAyMzA0MjI0N1owLDEqMCgGA1UEAwwhc2Ft
bC1maXh0dXJlLTEudGVzdHBsYW5pdC5pbnZhbGlkMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA2ikkSEn2N445EsZac1jG4eYwSUhyQ6zlNdS1Jynu/zMh
aslSA3tzlfdeGBbdi8f6Z0IhLBHZyY4dTo3jNqW5D5kAoX4szuGqq5DEjI2yh32M
Pu7bx3j3YT84QYQFkdmnFO5wJ5M2HST+W7DvN1P79RCTQXRUZDobhGGqAunjA/2G
pm0QDDglrYdLgcktHM8ju0/NFPfKb+Bklk7Eq7x3tTalJ/wmRhHHBc8gxSw/nmch
IZGG0/7tSqBxyLxfjxOSjC6tdouHQ8GQ8DPPKg72PDmPPfBYYur8nXDnGLI736Z9
6lBxr/5ecqa0jPvdwVJbrPvtghTwhfLVuehHgMvQ5QIDAQABo1MwUTAdBgNVHQ4E
FgQUA653mLzv+ImHNEH+2GsOAg0xiWYwHwYDVR0jBBgwFoAUA653mLzv+ImHNEH+
2GsOAg0xiWYwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAQYcF
h58j8WXHsz1oaC0msS3YsCvY89ea5Z0bBUq+NTA8Mwemb9gQcrySTM32jFbwOsEw
MIwr+Oxb6Snpur9mZOL5FQoTagdqggGTEwbIhdiFQ9BJWcxjHiOE9you3vWgFujz
ED7uwwK7swBt0PfNCbZLc5SAKvzROmRpe1l9+qNvklnHEzCJVZHrfPEWCj2SEMd5
yrBmTE9bihTMGAbmY3GkJc6e5hnkgSmue0JrPbtM7XA6gdVp6O3MKRJAZVS6NDTB
hZ1iHvLv5s5+lxLsnEsAVofxyZTmyMxynUhkoirunwGAMQwdmMSTDPeZti73xPqI
MlQhdCEgV16uXT3s3Q==
`.replace(/\s/g, "");
const CERT_BODY_2 = `
MIIDOTCCAiGgAwIBAgIUUigTo7DuVNv9KpeRDQu9WxJWTAYwDQYJKoZIhvcNAQEL
BQAwLDEqMCgGA1UEAwwhc2FtbC1maXh0dXJlLTIudGVzdHBsYW5pdC5pbnZhbGlk
MB4XDTI2MTAyODA0MjI0N1oXDTQ2MTAyMzA0MjI0N1owLDEqMCgGA1UEAwwhc2Ft
bC1maXh0dXJlLTIudGVzdHBsYW5pdC5pbnZhbGlkMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA5BgJgtDicQNKz+nNiYuYpAKxoln6zPDIZcweFD6vEOhd
6lENhJ+1hvSyhlPp538aqubeU08odIs+4tgLEqjWAzdBUu7taLxI+Y8bJgquYtj0
9ywghR9sjrq4gEHHeF2nVYjOw3cRQ1VHz8AC9iRP/KW/DRNPqSk1dN5tbTl12X0v
33pIzoFtl2SyI4UhVWKI3MhNP8AanNtKNRm5azdxT7VX4dful8YLJoBI4XbPfevr
qMvbbmO7APYAH92FPW6Gpy+uebFgeVVHFmF5m2R0sjwVhawlDU/JYNdp+t52jllf
We6BIPBR23WPww9wBS6aBf/KVjB8g+VUz8nLfZn62wIDAQABo1MwUTAdBgNVHQ4E
FgQU/63LYrW3X4rn1xnNInwc3QYj4Z0wHwYDVR0jBBgwFoAU/63LYrW3X4rn1xnN
Inwc3QYj4Z0wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAujSN
lErMu95AbBzI0ETx/bIJ5W/82JuNq/8EiPNz2GiqQQGrfuBvCGTWd2dgkcpNo+R7
eejCB2KgyKHcMvQ+3HbZv0+dGoAeyY6eh1wAlATxkaLSHXM9eP1/CIrtUjAgUwSY
oXrPGlddyD29uNrLo3zLavUMBHQAC/CpLv/voBvvgrefdNjRNdpaKmnDd6eWLUX8
23674EwK5cvkJIhxOiGacH+ULWXZjZd2EEve1usxm9o8uG51krALzB6htGWhB//u
7PvlCsdAS/FhT4mogwkXSBZIiQbxRt0vNsu050WnUM35bSxvHE94jn7LPACk+nj/
M4ETZamFBlXoqymoRw==
`.replace(/\s/g, "");

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
    const garbage = "this is definitely not a certificate!!!";
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
    const pems = await (
      client as unknown as {
        getKeyInfosAsPem: () => Promise<string[]>;
      }
    ).getKeyInfosAsPem();
    expect(pems).toHaveLength(1);
    expect(pems[0]).toContain("-----BEGIN CERTIFICATE-----");
    expect(pems[0]).toContain("-----END CERTIFICATE-----");

    // Negative control: node-saml rejects the un-normalized mangled cert,
    // confirming the normalization is what makes the client work. Matched on
    // the option name only — the rest of the message is node-saml's own and
    // has already been reworded once (5.1 said "is not in PEM format or in
    // base64 format", 5.2 says "is neither valid PEM nor a valid Base64
    // certificate"), so pinning it just breaks the test on upgrade.
    const raw = new SAML({
      callbackUrl: "https://app.example.com/api/auth/callback/saml",
      issuer: "https://app.example.com",
      idpCert: mangled,
    });
    await expect(
      (
        raw as unknown as {
          getKeyInfosAsPem: () => Promise<string[]>;
        }
      ).getKeyInfosAsPem()
    ).rejects.toThrow(/idpCert/);
  });
});
