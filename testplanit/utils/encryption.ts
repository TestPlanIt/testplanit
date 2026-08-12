import crypto from "crypto";
import { getTenantContext } from "@/lib/tenantContext";

const algorithm = "aes-256-gcm";
const ivLength = 16;
const saltLength = 32;
const tagLength = 16;
const iterations = 100000;
const keyLength = 32;

const DEV_FALLBACK_KEY = "development-key-do-not-use-in-production-please!";

// Resolve the master key used to derive per-value AES-256-GCM keys. Three
// sources are tried in order:
//   1. process.env.ENCRYPTION_KEY — app pods mount a per-tenant env secret
//      containing the tenant's key, so this path covers all app-side callers.
//   2. Tenant context — the shared multi-tenant worker serves many tenants
//      from one process and establishes context per job (see tenantContext).
//   3. Dev fallback — only in non-production, with a warning. In production
//      we refuse rather than silently encrypting with a known default, which
//      would leave integration credentials, OAuth tokens, LLM API keys, and
//      2FA secrets effectively plaintext to anyone with the source.
export const getMasterKey = (): string => {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) return envKey;

  const ctx = getTenantContext();
  if (ctx?.encryptionKey) return ctx.encryptionKey;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ENCRYPTION_KEY is not available — neither process.env.ENCRYPTION_KEY " +
        "nor tenant context provided a key. App pods must set ENCRYPTION_KEY " +
        "in their env; shared workers must run each job inside " +
        "runWithTenantContext(tenantId, ...) so the tenant's key can be " +
        "resolved from its Kubernetes Secret. Refusing to fall back to the " +
        "built-in default key, which would expose every encrypted secret in " +
        "the database."
    );
  }
  console.warn("ENCRYPTION_KEY not set, using default key for development");
  return DEV_FALLBACK_KEY;
};

/**
 * Startup probe for **app pods** — call during Next.js boot to fail fast
 * on missing ENCRYPTION_KEY rather than when the first encrypt/decrypt
 * happens mid-request.
 *
 * Not appropriate for shared worker pods: those serve many tenants from
 * one process and each tenant has its own key, so there is no single key
 * to check at startup. Workers resolve keys per-job via tenant context.
 */
export const assertEncryptionConfigured = (): string => {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) return envKey;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ENCRYPTION_KEY is not set in the pod environment. This probe is for " +
        "per-tenant app pods; see tenantContext for the shared-worker path."
    );
  }
  console.warn("ENCRYPTION_KEY not set, using default key for development");
  return DEV_FALLBACK_KEY;
};

// Alias for backward compatibility
const getEncryptionKey = getMasterKey;

// Derive key from password using PBKDF2
const deriveKey = (password: string, salt: Buffer): Buffer => {
  return crypto.pbkdf2Sync(password, salt, iterations, keyLength, "sha256");
};

// Encrypt a value
export const encrypt = async (text: string): Promise<string> => {
  try {
    const password = getEncryptionKey();
    const salt = crypto.randomBytes(saltLength);
    const key = deriveKey(password, salt);
    const iv = crypto.randomBytes(ivLength);

    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Combine salt, iv, tag, and encrypted data
    const combined = Buffer.concat([salt, iv, tag, encrypted]);

    return combined.toString("base64");
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
};

// Decrypt a value
export const decrypt = async (encryptedText: string): Promise<string> => {
  try {
    const password = getEncryptionKey();
    const combined = Buffer.from(encryptedText, "base64");

    // Extract components
    const salt = combined.slice(0, saltLength);
    const iv = combined.slice(saltLength, saltLength + ivLength);
    const tag = combined.slice(
      saltLength + ivLength,
      saltLength + ivLength + tagLength
    );
    const encrypted = combined.slice(saltLength + ivLength + tagLength);

    const key = deriveKey(password, salt);

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt data");
  }
};

/**
 * Whether a stored string looks like output of `encrypt()`.
 *
 * `Buffer.from(value, "base64")` never throws — it skips characters outside
 * the base64 alphabet — so a length check alone accepted arbitrary plaintext
 * of sufficient length and, symmetrically, could reject nothing. This checks
 * that the value is *canonical* base64 (the exact form `toString("base64")`
 * produces) and that it decodes to a full salt + IV + tag plus at least one
 * byte of ciphertext.
 *
 * A false positive is no longer load-bearing: callers must treat a decrypt
 * failure as a corrupt credential rather than falling back to the raw value.
 */
export const isEncrypted = (value: string): boolean => {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) return false;

  return decoded.length > saltLength + ivLength + tagLength;
};

// EncryptionService class for object encryption/decryption
export class EncryptionService {
  static encrypt(text: string, key: string): string {
    const salt = crypto.randomBytes(saltLength);
    const derivedKey = deriveKey(key, salt);
    const iv = crypto.randomBytes(ivLength);

    const cipher = crypto.createCipheriv(algorithm, derivedKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Combine salt, iv, tag, and encrypted data
    const combined = Buffer.concat([salt, iv, tag, encrypted]);

    return combined.toString("base64");
  }

  static decrypt(encryptedText: string, key: string): string {
    const combined = Buffer.from(encryptedText, "base64");

    // Extract components
    const salt = combined.slice(0, saltLength);
    const iv = combined.slice(saltLength, saltLength + ivLength);
    const tag = combined.slice(
      saltLength + ivLength,
      saltLength + ivLength + tagLength
    );
    const encrypted = combined.slice(saltLength + ivLength + tagLength);

    const derivedKey = deriveKey(key, salt);

    const decipher = crypto.createDecipheriv(algorithm, derivedKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  static encryptObject(obj: any, key: string): string {
    return this.encrypt(JSON.stringify(obj), key);
  }

  static decryptObject(encryptedText: string, key: string): any {
    return JSON.parse(this.decrypt(encryptedText, key));
  }
}
