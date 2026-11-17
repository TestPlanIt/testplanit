// @vitest-environment node
import { SAML } from "@node-saml/node-saml";
import { describe, expect, it, vi } from "vitest";

import { createSAMLClient, type SAMLConfig } from "./saml-provider";

vi.hoisted(() => {
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

// A real self-signed certificate (public material only). The
// signature-validation behaviour under test does not depend on the cert
// content, but node-saml parses the certificate rather than pattern-matching
// it, so a decodeable-base64 stand-in only survives here for as long as no
// assertion forces the parse.
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

function pem(body: string): string {
  const wrapped = body.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----\n`;
}

const baseConfig: SAMLConfig = {
  name: "test",
  entryPoint: "https://idp.example.com/sso",
  issuer: "https://app.example.com",
  cert: pem(CERT_BODY),
};

// node-saml stores the resolved options (ctor value ?? library default) on
// `client.options`, which is what an SP-side validation actually enforces.
function resolvedOptions(client: SAML) {
  return (
    client as unknown as {
      options: {
        wantAssertionsSigned: boolean;
        wantAuthnResponseSigned: boolean;
      };
    }
  ).options;
}

describe("createSAMLClient signature-validation defaults", () => {
  it("requires a signed assertion but not a signed response when the config omits both", async () => {
    const client = await createSAMLClient(baseConfig);
    const options = resolvedOptions(client);

    expect(options.wantAssertionsSigned).toBe(true);
    expect(options.wantAuthnResponseSigned).toBe(false);
  });

  it("relaxes the response-signature requirement that node-saml enables by default", async () => {
    // node-saml defaults wantAuthnResponseSigned to true, which rejects the
    // common assertion-only-signed IdP configuration ("Invalid signature").
    const nodeSamlDefault = new SAML({
      callbackUrl: "https://app.example.com/api/auth/callback/saml",
      issuer: "https://app.example.com",
      idpCert: pem(CERT_BODY),
    });
    expect(resolvedOptions(nodeSamlDefault).wantAuthnResponseSigned).toBe(true);

    // Our client flips that default to false so the standard setup works.
    const client = await createSAMLClient(baseConfig);
    expect(resolvedOptions(client).wantAuthnResponseSigned).toBe(false);
  });

  it("honors explicit config values over the defaults", async () => {
    const client = await createSAMLClient({
      ...baseConfig,
      wantAssertionsSigned: false,
      wantAuthnResponseSigned: true,
    });
    const options = resolvedOptions(client);

    expect(options.wantAssertionsSigned).toBe(false);
    expect(options.wantAuthnResponseSigned).toBe(true);
  });
});
