import { decrypt, isEncrypted } from "@/utils/encryption";
import { credentialsCorruptError } from "./errors";

/**
 * Reading stored integration credentials.
 *
 * Two storage shapes exist. Current writers (POST /api/integrations and PUT
 * /api/integrations/[id]) serialize the whole credential object and store one
 * ciphertext under `{ encrypted }`. Older rows store one key per field, each
 * value encrypted individually.
 *
 * Both shapes are read here, and neither may fall back to using an
 * unreadable value. A credential that cannot be decrypted is a corrupt
 * record, not a credential: forwarding it upstream authenticates nothing and
 * burns a rate-limit slot.
 *
 * "Unreadable" means exactly that — ciphertext we cannot decrypt. A secret
 * sitting in cleartext is badly *stored*, not unreadable, and is used as-is
 * with a warning. Refusing it instead breaks integrations that work, with no
 * migration that would fix them: OAuth2 client credentials predate the
 * encrypting write path, so those rows hold cleartext `clientSecret` values
 * and every adapter build for them would fail.
 */

/**
 * Credential fields that must be encrypted at rest. Everything else in the
 * credential object (identifiers such as `email`, `username`, `clientId`) is
 * not a secret and is stored in the clear by design.
 */
export const SECRET_CREDENTIAL_KEYS = new Set([
  "apiToken",
  "password",
  "personalAccessToken",
  "clientSecret",
  "accessToken",
  "refreshToken",
  "privateKey",
  "webhookSecret",
  "token",
  "secret",
]);

export const isSecretCredentialKey = (key: string): boolean =>
  SECRET_CREDENTIAL_KEYS.has(key);

const hasEncryptedBlob = (
  value: Record<string, unknown>
): value is { encrypted: string } =>
  "encrypted" in value && typeof value.encrypted === "string";

/**
 * Decrypt stored integration credentials into a plain field map.
 *
 * Throws `IntegrationApiError` with kind `credentials_corrupt` when a secret
 * cannot be decrypted. Callers must let that propagate rather than proceeding
 * with partial credentials — the point is that no outbound request is made
 * with a value we could not read.
 */
export const resolveStoredCredentials = async (
  raw: unknown,
  provider: string
): Promise<Record<string, string>> => {
  if (!raw || typeof raw !== "object") return {};

  const stored = raw as Record<string, unknown>;

  if (hasEncryptedBlob(stored)) {
    let decrypted: string;
    try {
      decrypted = await decrypt(stored.encrypted);
    } catch (error) {
      throw credentialsCorruptError(provider, { cause: error });
    }

    try {
      return JSON.parse(decrypted) as Record<string, string>;
    } catch (error) {
      throw credentialsCorruptError(provider, { cause: error });
    }
  }

  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(stored)) {
    if (typeof value !== "string" || value === "") continue;

    if (!isSecretCredentialKey(key)) {
      resolved[key] = value;
      continue;
    }

    // Not ciphertext, so there is nothing to decrypt and nothing unreadable
    // about it — use it and say so. Re-saving the integration rewrites it
    // through the encrypting write path. `isEncrypted` requires canonical
    // base64 over a full salt + IV + tag, which real ciphertext always
    // satisfies, so this branch cannot swallow a value we should have
    // decrypted.
    if (!isEncrypted(value)) {
      console.warn(
        `[integrations] ${provider} credential "${key}" is stored in cleartext; ` +
          `re-save the integration to encrypt it at rest.`
      );
      resolved[key] = value;
      continue;
    }

    try {
      resolved[key] = await decrypt(value);
    } catch (error) {
      throw credentialsCorruptError(provider, { cause: error });
    }
  }

  return resolved;
};
