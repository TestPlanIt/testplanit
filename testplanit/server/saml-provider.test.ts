// @vitest-environment node
import { SAML } from "@node-saml/node-saml";
import { describe, expect, it, vi } from "vitest";

import { createSAMLClient, type SAMLConfig } from "./saml-provider";

vi.hoisted(() => {
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

// node-saml only needs a decodeable base64 PEM body to construct a client; the
// signature-validation behavior under test does not depend on the cert content.
const CERT_BODY = Buffer.from("a".repeat(900)).toString("base64");

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
