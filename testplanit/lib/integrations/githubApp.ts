import jwt from "jsonwebtoken";

/**
 * Authentication as a GitHub App installation. The App's private key signs
 * a short-lived JWT, which GitHub exchanges for an installation access
 * token that lasts one hour and carries the permissions the App was given
 * on the repositories it is installed on.
 */
export interface GitHubAppCredentials {
  /** The REST API root; a GitHub Enterprise Server's, or github.com's. */
  baseUrl?: string;
  appId: string;
  installationId: string;
  /** The App's private key, PEM. */
  privateKey: string;
}

export interface GitHubInstallationToken {
  token: string;
  expiresAt: Date;
}

const DEFAULT_API_ROOT = "https://api.github.com";

/** GitHub refuses an App JWT that lives longer than ten minutes. */
const JWT_LIFETIME_SECONDS = 9 * 60;

/** Backdated so a clock that runs ahead of GitHub's is still accepted. */
const JWT_BACKDATE_SECONDS = 60;

/**
 * A PEM as it was pasted. A key that went through a single-line field or
 * an environment variable has its line breaks written as `\n`.
 */
export function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n").trim();
}

export function createGitHubAppJwt(
  appId: string,
  privateKey: string,
  now: number = Date.now()
): string {
  const issuedAt = Math.floor(now / 1000) - JWT_BACKDATE_SECONDS;
  return jwt.sign(
    {
      iat: issuedAt,
      exp: issuedAt + JWT_BACKDATE_SECONDS + JWT_LIFETIME_SECONDS,
      iss: String(appId).trim(),
    },
    normalizePrivateKey(privateKey),
    { algorithm: "RS256" }
  );
}

export function githubApiRoot(baseUrl?: string): string {
  return (baseUrl || DEFAULT_API_ROOT).replace(/\/$/, "");
}

function missing(credentials: Partial<GitHubAppCredentials>): string[] {
  return (["appId", "installationId", "privateKey"] as const).filter(
    (key) => !String(credentials[key] ?? "").trim()
  );
}

/**
 * Exchanges the App's JWT for an installation access token. Throws with
 * GitHub's own reason when it refuses: a wrong App ID or key (401), an
 * installation that does not exist or belongs to another App (404).
 */
export async function mintGitHubInstallationToken(
  credentials: Partial<GitHubAppCredentials>
): Promise<GitHubInstallationToken> {
  const absent = missing(credentials);
  if (absent.length > 0) {
    throw new Error(
      `GitHub App configuration is incomplete (missing ${absent.join(", ")})`
    );
  }
  const { appId, installationId, privateKey, baseUrl } =
    credentials as GitHubAppCredentials;

  let appJwt: string;
  try {
    appJwt = createGitHubAppJwt(appId, privateKey);
  } catch {
    // The library's message can quote the key material it failed to read.
    throw new Error(
      "The GitHub App private key could not be read; paste the whole .pem file"
    );
  }

  const response = await fetch(
    `${githubApiRoot(baseUrl)}/app/installations/${encodeURIComponent(String(installationId).trim())}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (typeof body?.message === "string") detail = body.message;
    } catch {
      /* not JSON: keep the status text */
    }
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  const body = await response.json();
  if (typeof body?.token !== "string" || !body.token) {
    throw new Error("GitHub returned no installation token");
  }
  return {
    token: body.token,
    expiresAt: body.expires_at
      ? new Date(body.expires_at)
      : new Date(Date.now() + 60 * 60 * 1000),
  };
}
