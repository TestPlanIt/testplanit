/**
 * A version-4 UUID that also works on an insecure origin.
 *
 * `crypto.randomUUID()` exists only in a secure context — HTTPS, plus the
 * `localhost` / `127.0.0.1` exceptions — so on a self-host served over plain
 * HTTP at a LAN address or an internal hostname the method is absent entirely
 * and calling it throws. `crypto.getRandomValues()` carries no such
 * restriction.
 */
export function randomUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version 4, variant 1 — the two fields RFC 4122 pins for a random UUID.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
