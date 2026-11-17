/**
 * Origins the page's Content-Security-Policy has refused to fetch from or
 * frame, as the browser reports them. A file stored on a host the policy does
 * not list (a former storage host, say) fails to load without telling the
 * code that asked for it why, so previews read this to say so.
 */

const FILE_DIRECTIVES = new Set(["connect-src", "frame-src"]);

const blockedOrigins = new Set<string>();
const listeners = new Set<() => void>();

function originOf(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function recordCspViolation(
  event: Pick<
    SecurityPolicyViolationEvent,
    "blockedURI" | "disposition" | "effectiveDirective"
  >
): void {
  if (event.disposition !== "enforce") return;
  if (!FILE_DIRECTIVES.has(event.effectiveDirective)) return;
  const origin = originOf(event.blockedURI);
  if (!origin || blockedOrigins.has(origin)) return;
  blockedOrigins.add(origin);
  listeners.forEach((listener) => listener());
}

/** Whether the policy has blocked a load from the host that serves `url`. */
export function isCspBlocked(url: string): boolean {
  const origin = originOf(url);
  return origin !== null && blockedOrigins.has(origin);
}

export function subscribeToCspBlocks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetCspBlocks(): void {
  blockedOrigins.clear();
}

// Listening from module load: a violation is reported once, and a preview
// that mounts afterwards still has to know about it.
if (typeof document !== "undefined") {
  document.addEventListener("securitypolicyviolation", recordCspViolation);
}
