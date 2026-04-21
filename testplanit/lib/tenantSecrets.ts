import { promises as fs } from "fs";
import * as https from "https";

// Looks up per-tenant secret values from the Kubernetes API at runtime.
// Used by the shared multi-tenant worker deployment, which cannot have every
// tenant's ENCRYPTION_KEY in its own process environment. Authenticates using
// the pod's in-cluster ServiceAccount token.
//
// Operational note: the Kubernetes API is on the critical path for every job
// served by a shared worker. A cold cache (pod start or after TTL) plus a
// Kubernetes API outage will fail jobs. Mitigations in place:
//   - In-memory TTL cache (default 10 minutes, env-tunable).
//   - Request deduplication: concurrent fetches for the same tenant share a
//     single in-flight Promise.
// If the cluster control plane is healthy, fetches are ~single-digit ms.

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const NAMESPACE_PATH = `${SA_DIR}/namespace`;
const TOKEN_PATH = `${SA_DIR}/token`;
const CA_PATH = `${SA_DIR}/ca.crt`;

const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const keyCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

async function resolveNamespace(): Promise<string> {
  const explicit = process.env.TENANT_SECRETS_NAMESPACE;
  if (explicit) return explicit;
  return (await fs.readFile(NAMESPACE_PATH, "utf8")).trim();
}

function resolveSecretName(tenantId: string): string {
  const template = process.env.TENANT_SECRET_NAME_TEMPLATE || "tpi-{tenant}-env";
  return template.replace("{tenant}", tenantId);
}

async function kubeGet(path: string): Promise<any> {
  // Read token and CA on every request so projected-SA-token rotation (done
  // by kubelet every hour or so) is picked up without needing a restart.
  const [token, ca] = await Promise.all([
    fs.readFile(TOKEN_PATH, "utf8").then((s) => s.trim()),
    fs.readFile(CA_PATH),
  ]);
  const host = process.env.KUBERNETES_SERVICE_HOST || "kubernetes.default.svc";
  const port = process.env.KUBERNETES_SERVICE_PORT || "443";

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port,
        path,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        ca,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(
              new Error(
                `Kubernetes API ${res.statusCode} for ${path}: ${body.slice(0, 200)}`
              )
            );
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Invalid JSON from Kubernetes API: ${e}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function extractEncryptionKey(envFileContent: string): string | null {
  // Matches lines like:   ENCRYPTION_KEY=value   or   ENCRYPTION_KEY="value"
  // Ignores commented lines. Stops at first newline.
  for (const rawLine of envFileContent.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^ENCRYPTION_KEY\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[1].trim();
    // Strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return null;
}

async function fetchEncryptionKey(tenantId: string): Promise<string> {
  const namespace = await resolveNamespace();
  const secretName = resolveSecretName(tenantId);
  const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(secretName)}`;
  const secret = await kubeGet(path);
  const data = secret?.data || {};

  // Preferred shape: entire .env file in data.env (used by tpi-<tenant>-env)
  const envB64: string | undefined = data.env;
  if (envB64) {
    const env = Buffer.from(envB64, "base64").toString("utf8");
    const key = extractEncryptionKey(env);
    if (key) return key;
  }

  // Fallback shape: individual keys (e.g. data.ENCRYPTION_KEY)
  const directB64: string | undefined = data.ENCRYPTION_KEY;
  if (directB64) {
    const v = Buffer.from(directB64, "base64").toString("utf8").trim();
    if (v) return v;
  }

  throw new Error(
    `Secret ${secretName} in namespace ${namespace} has no ENCRYPTION_KEY`
  );
}

export async function getTenantEncryptionKey(tenantId: string): Promise<string> {
  const ttl = parseInt(
    process.env.TENANT_SECRETS_CACHE_TTL_MS || String(DEFAULT_TTL_MS),
    10
  );
  // Key on namespace+tenantId so a runtime change to TENANT_SECRETS_NAMESPACE
  // (rare, but happens in tests) never serves a stale value from the old
  // namespace. Namespace is stable in a deployed pod, so in practice this is
  // equivalent to keying on tenantId alone.
  const namespace = await resolveNamespace();
  const cacheKey = `${namespace}:${tenantId}`;

  const cached = keyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.value;
  }

  // Dedupe concurrent cache misses for the same tenant — N jobs arriving
  // together after pod start / TTL expiry should trigger one API call, not N.
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = fetchEncryptionKey(tenantId)
    .then((value) => {
      keyCache.set(cacheKey, { value, fetchedAt: Date.now() });
      return value;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, promise);
  return promise;
}

// Exported for tests only. _resetForTests no-ops in production so an
// accidental import from runtime code can't flush the cache.
export const __internals = {
  extractEncryptionKey,
  resolveSecretName,
  _resetForTests: () => {
    if (process.env.NODE_ENV === "production") return;
    keyCache.clear();
    inFlight.clear();
  },
};
