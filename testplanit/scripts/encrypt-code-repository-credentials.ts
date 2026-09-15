/**
 * Encrypt code repository credentials saved before the app encrypted them.
 *
 * The web server does this on every start (see
 * lib/integrations/ensureCodeRepositoryCredentialsEncrypted.ts); this is the
 * same pass for an operator who wants to run it by hand. Safe to rerun: rows
 * already encrypted are skipped.
 *
 *   pnpm exec dotenv -e .env -- tsx scripts/encrypt-code-repository-credentials.ts
 */
import {
  type CredentialRewriter,
  encryptLegacyCodeRepositoryCredentials,
} from "../lib/integrations/ensureCodeRepositoryCredentialsEncrypted";
import { baseClient } from "../lib/zenstack";

async function main() {
  const result = await encryptLegacyCodeRepositoryCredentials(
    baseClient as unknown as CredentialRewriter,
    console.log
  );
  console.log(
    `done: ${result.rewritten} encrypted, ${result.unreadable} unreadable, ${result.total} checked`
  );
  process.exit(result.unreadable > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
