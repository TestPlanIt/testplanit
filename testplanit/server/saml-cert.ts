// IdP signing-certificate normalization.
//
// Admins paste the IdP certificate into the generic SSO config form, which
// stores whatever they paste verbatim. A copy/paste or JSON round-trip can
// collapse the PEM line breaks into spaces, leaving the
// `-----BEGIN/END CERTIFICATE-----` markers and the base64 body all on one
// line. That value is neither valid PEM (node-saml's PEM regex requires
// newlines) nor valid base64 (spaces and the marker dashes aren't base64
// characters), so node-saml rejects it at validation time with
// "idpCert is not in PEM format or in base64 format".
//
// These helpers recover the base64 body regardless of whitespace mangling and
// re-emit canonical PEM (markers + base64 wrapped at 64 chars). They are
// deliberately defensive: anything that doesn't decode as base64 is returned
// untouched, so a genuinely different or future format is never silently
// corrupted.

const PEM_LABEL = "CERTIFICATE";

// Certificate markers carry a single space between the verb and the label
// ("BEGIN CERTIFICATE"), and labels never contain a dash, so `[^-]+` matches
// the label without swallowing the trailing dashes. The body capture is
// non-greedy so each BEGIN pairs with its nearest END (a chain stays split).
const BEGIN_MARKER = /-----BEGIN [^-]+-----/;
const CERT_BLOCK = /-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/g;

function isBase64Body(body: string): boolean {
  if (body.length === 0 || body.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return false;
  try {
    return Buffer.from(body, "base64").length > 0;
  } catch {
    return false;
  }
}

function wrapAsPem(body: string): string {
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${PEM_LABEL}-----\n${wrapped}\n-----END ${PEM_LABEL}-----\n`;
}

/**
 * Pull the base64 body out of every certificate in `cert` and return them as
 * canonical PEM blocks. Returns `null` when nothing in the input decodes as
 * base64 (the signal for callers to leave the original value untouched).
 */
function canonicalizeCertBlocks(cert: string): string[] | null {
  // When markers are present, take the content between each BEGIN/END pair so
  // a concatenated chain splits cleanly. With no markers the whole value is
  // treated as a single bare base64 body. Either way the candidate bodies have
  // all whitespace stripped before being validated as base64.
  const rawBodies = BEGIN_MARKER.test(cert)
    ? [...cert.matchAll(CERT_BLOCK)].map((match) => match[1])
    : [cert];

  const bodies = rawBodies
    .map((body) => body.replace(/\s+/g, ""))
    .filter((body) => body.length > 0);

  if (bodies.length === 0) return null;
  if (!bodies.every(isBase64Body)) return null;

  return bodies.map(wrapAsPem);
}

/**
 * Normalize a stored certificate value to canonical PEM for persistence.
 *
 * Idempotent: re-normalizing an already-canonical value yields the same
 * string. A multi-certificate chain is returned as the canonical blocks
 * concatenated. Non-base64 input is returned unchanged.
 */
export function normalizeSamlCert(cert: string): string {
  if (typeof cert !== "string") return cert;
  const blocks = canonicalizeCertBlocks(cert);
  return blocks ? blocks.join("") : cert;
}

/**
 * Normalize a certificate for handoff to node-saml's `idpCert` option.
 *
 * A single certificate is returned as a PEM string; a chain is returned as an
 * array of PEM strings (node-saml accepts `string | string[]`). Passing a
 * chain as one concatenated string would let node-saml's PEM normalizer
 * re-wrap across the internal markers and corrupt the boundary, so the array
 * form is used whenever more than one certificate is present. Non-base64
 * input is returned unchanged.
 */
export function normalizeSamlCertForClient(cert: string): string | string[] {
  if (typeof cert !== "string") return cert;
  const blocks = canonicalizeCertBlocks(cert);
  if (!blocks) return cert;
  return blocks.length === 1 ? blocks[0] : blocks;
}
