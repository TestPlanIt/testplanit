/**
 * Base URL for the server to call its own routes (the shared-report proxy,
 * the share page's metadata lookup).
 *
 * NEXTAUTH_URL is the browser-facing address and is often unreachable from
 * inside the server: a port-mapped container sees nothing on the host port,
 * and a public URL may not hairpin. The standalone server in the Docker image
 * listens on HOSTNAME:PORT, and Docker sets HOSTNAME to the container id, so
 * loopback is not bound there either. Order:
 * 1. INTERNAL_APP_URL, when an operator sets it explicitly
 * 2. the address the standalone server listens on, when PORT is set
 * 3. NEXTAUTH_URL (local `next start` / dev), else localhost:3000
 */
export function internalAppUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const explicit = env.INTERNAL_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (env.PORT) {
    const hostname = env.HOSTNAME?.trim();
    const host =
      hostname && hostname !== "0.0.0.0" && hostname !== "::"
        ? hostname
        : "127.0.0.1";
    return `http://${host}:${env.PORT}`;
  }

  return (env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}
