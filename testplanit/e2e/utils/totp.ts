import { createHmac } from "crypto";

/**
 * Generate the current TOTP code for a Base32-encoded secret (SHA-1 HMAC,
 * 30-second step, six digits, per RFC 6238): what an authenticator app shows.
 */
export function generateTOTP(secret: string): string {
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/, "")) {
    const val = base32chars.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac("sha1", Buffer.from(bytes));
  hmac.update(counterBuf);
  const hmacResult = hmac.digest();
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const code =
    (((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff)) %
    1000000;
  return code.toString().padStart(6, "0");
}
