import { withBasePath } from "./basePath";

/**
 * Content-Security-Policy for the app's pages.
 *
 * The policy is built per request so every inline script Next emits can carry
 * a one-time nonce; the proxy generates the nonce, hands it to Next through
 * the request headers, and sets the finished header on the response. Pages
 * only: API routes return JSON and get no policy.
 *
 * CSP_MODE picks how the browser treats the policy:
 *   report-only  send violations to /api/csp-report, block nothing (default)
 *   enforce      block anything the policy does not allow
 *   off          send no policy
 *
 * Operators whose pages load from hosts this file cannot know about (a CDN in
 * front of storage, an embedded viewer) list them in CSP_ALLOWED_ORIGINS, and
 * CSP_FRAME_ANCESTORS names the sites allowed to put the app in a frame.
 */

export type CspMode = "off" | "report-only" | "enforce";

export const CSP_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
/** Request header the proxy uses to pass the nonce to server components. */
export const CSP_NONCE_HEADER = "x-nonce";
export const CSP_REPORT_PATH = "/api/csp-report";

type Env = Record<string, string | undefined>;

export function getCspMode(env: Env = process.env): CspMode {
  const raw = env.CSP_MODE?.trim().toLowerCase();
  if (raw === "enforce" || raw === "off") return raw;
  return "report-only";
}

export function cspHeaderName(mode: Exclude<CspMode, "off">): string {
  return mode === "enforce" ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;
}

/** 128 bits of randomness, base64: what the CSP spec asks of a nonce. */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** `https://host[:port]` of a URL, or null when it does not parse. */
function originOf(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/** Comma- or whitespace-separated CSP source expressions from an env var. */
function listFromEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Hosts the browser reaches for stored files when the install serves them
 * straight from storage (presigned URLs) rather than through /api/storage:
 * the configured endpoints, or AWS S3's own hostnames when there is none.
 */
function storageOrigins(env: Env): string[] {
  const configured = [
    originOf(env.AWS_PUBLIC_ENDPOINT_URL),
    originOf(env.AWS_ENDPOINT_URL),
  ].filter((o): o is string => Boolean(o));
  if (configured.length > 0) return configured;

  const bucket = env.AWS_BUCKET_NAME?.trim();
  if (!bucket) return [];
  const region = (env.AWS_REGION || env.AWS_BUCKET_REGION)?.trim();
  return [
    `https://${bucket}.s3.amazonaws.com`,
    ...(region ? [`https://${bucket}.s3.${region}.amazonaws.com`] : []),
  ];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export interface BuildCspOptions {
  nonce: string;
  env?: Env;
  /** Next's dev server needs eval for source maps and a socket for HMR. */
  isDevelopment?: boolean;
}

export function buildContentSecurityPolicy({
  nonce,
  env = process.env,
  isDevelopment = process.env.NODE_ENV === "development",
}: BuildCspOptions): string {
  const extra = listFromEnv(env.CSP_ALLOWED_ORIGINS);
  const storage = storageOrigins(env);
  const frameAncestors = listFromEnv(env.CSP_FRAME_ANCESTORS);
  // The feedback survey is an embedded third-party form.
  const survey = originOf(env.FEEDBACK_SURVEY_URL);

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // Scripts a nonced script loads (Next's chunks) are trusted too.
    "'strict-dynamic'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Tailwind and the editor set inline style attributes throughout.
    "style-src": ["'self'", "'unsafe-inline'"],
    // User content: avatars from identity providers, images and videos
    // pasted into the editor by URL, favicons of linked sites, attachments on
    // the storage host. Any web host, so the scheme sources stand in for the
    // storage and extra origins too.
    "img-src": ["'self'", "data:", "blob:", "https:", "http:"],
    "media-src": ["'self'", "data:", "blob:", "https:", "http:"],
    "font-src": ["'self'", "data:"],
    // Uploads go straight to storage with presigned URLs; previews read
    // attachments back the same way.
    "connect-src": unique([
      "'self'",
      ...storage,
      ...extra,
      ...(isDevelopment ? ["ws:", "wss:"] : []),
    ]),
    // PDF previews frame the stored file; the survey frames its form.
    "frame-src": unique([
      "'self'",
      "blob:",
      ...storage,
      ...(survey ? [survey] : []),
      ...extra,
    ]),
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": frameAncestors.length ? frameAncestors : ["'self'"],
    "report-uri": [withBasePath(CSP_REPORT_PATH)],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
