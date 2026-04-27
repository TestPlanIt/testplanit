import { createHmac } from "node:crypto";
import type { AdapterType } from "@prisma/client";
import type {
  FormattedHttpRequest,
  OutboundEnvelope,
  OutboundWebhookAdapter,
  SignatureHeaders,
  SigningSecretSet,
} from "./types";

/** Header name for outbound signatures — exported so tests / docs reference it consistently. */
export const OUTBOUND_SIGNATURE_HEADER = "X-TestPlanIt-Signature" as const;

/**
 * D-19 / D-06 / OUT-06 / OUT-08 — Stripe-style HMAC-SHA256 signature with
 * 5-minute replay-tolerance window enforced by the consumer.
 *
 * Wire format (steady state):
 *   X-TestPlanIt-Signature: t=1714234567,v1=<hex_active>
 *
 * Wire format (during 7-day rotation overlap — D-06):
 *   X-TestPlanIt-Signature: t=1714234567,v1=<hex_active>,v1=<hex_retiring>
 *
 * Receivers iterate v1= entries until one matches their stored secret. Both
 * signatures cover IDENTICAL payloads (`<ts>.<body>`); the receiver just
 * tries each entry until one verifies — Stripe's documented pattern.
 *
 * @internal Exported separately for unit testing — production callers should
 * use genericHmacAdapter.sign().
 */
export function signGenericHmac(
  body: string,
  activeSecret: string,
  retiringSecret?: string | null,
  nowFn: () => number = Date.now
): string {
  const t = Math.floor(nowFn() / 1000);
  const signedPayload = `${t}.${body}`;
  const v1Active = createHmac("sha256", activeSecret)
    .update(signedPayload)
    .digest("hex");
  if (!retiringSecret) {
    return `t=${t},v1=${v1Active}`;
  }
  const v1Retiring = createHmac("sha256", retiringSecret)
    .update(signedPayload)
    .digest("hex");
  return `t=${t},v1=${v1Active},v1=${v1Retiring}`;
}

/**
 * D-19 / OUT-06 — generic-HMAC outbound adapter. Emits the OUT-20 envelope
 * verbatim as the wire body and signs with HMAC-SHA256 over `<unix_ts>.<body>`.
 */
export const genericHmacAdapter: OutboundWebhookAdapter = {
  adapterType: "GENERIC_HMAC" satisfies AdapterType,
  format(envelope: OutboundEnvelope): FormattedHttpRequest {
    return {
      body: JSON.stringify(envelope),
      contentType: "application/json",
    };
  },
  sign(body: string, secrets: SigningSecretSet): SignatureHeaders {
    return {
      [OUTBOUND_SIGNATURE_HEADER]: signGenericHmac(
        body,
        secrets.active,
        secrets.retiring
      ),
    };
  },
};
