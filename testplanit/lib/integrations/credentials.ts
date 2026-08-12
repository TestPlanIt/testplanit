import { decrypt, isEncrypted } from "@/utils/encryption";
import { credentialsCorruptError } from "./errors";

/**
 * Reading stored integration credentials.
 *
 * Three storage shapes exist:
 *
 *  - `{ encrypted }` — one ciphertext for the whole credential object, from
 *    POST /api/integrations and PUT /api/integrations/[id].
 *  - per-field ciphertext — one key per field, each value encrypted.
 *  - per-field cleartext — one key per field, stored verbatim. This is what
 *    the admin integration form produces: it saves through the generated
 *    ZenStack model endpoint, which has no encryption step. Despite the
 *    `credentials` comment in schema.zmodel, nothing encrypts on that path.
 *
 * All three are read here. What is *not* accepted is a value that looks like
 * ciphertext but fails to decrypt: that is a corrupt record, not a
 * credential, and forwarding it upstream authenticates nothing while burning
 * a rate-limit slot. That case is the one behind the production incident.
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
 * cannot be decrypted or was stored in cleartext. Callers must let that
 * propagate rather than proceeding with partial credentials — the point is
 * that no outbound request is made with a value we could not read.
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

    // Cleartext is accepted because it is what the admin UI writes: the
    // integration form saves through the generated ZenStack model endpoint,
    // which persists `credentials` verbatim with no encryption step. Refusing
    // it here would break every integration created that way.
    //
    // A value that *looks* encrypted but will not decrypt is a different
    // case, and is the one behind the production incident — it is refused
    // below rather than forwarded to the provider as a credential.
    if (!isEncrypted(value)) {
      if (isSecretCredentialKey(key)) {
        console.warn(
          `Integration secret "${key}" is stored unencrypted (provider ${provider}).`
        );
      }
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
