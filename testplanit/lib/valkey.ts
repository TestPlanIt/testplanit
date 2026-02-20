import IORedis from "ioredis";

// Check if we should skip Valkey connection (useful during build)
const skipConnection = process.env.SKIP_VALKEY_CONNECTION === "true";

// Get configuration from environment
const valkeyUrl = process.env.VALKEY_URL;
const valkeySentinels = process.env.VALKEY_SENTINELS;
const sentinelMasterName = process.env.VALKEY_SENTINEL_MASTER || "mymaster";
const sentinelPassword = process.env.VALKEY_SENTINEL_PASSWORD;

// Base connection options required by BullMQ
const baseOptions = {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false, // Helps with startup race conditions and Sentinel failover
};

/**
 * Parse a comma-separated list of sentinel addresses into the format ioredis expects.
 * Accepts: "host1:port1,host2:port2,host3:port3"
 * Default port is 26379 if omitted.
 */
export function parseSentinels(
  sentinelStr: string
): Array<{ host: string; port: number }> {
  return sentinelStr.split(",").map((entry) => {
    const trimmed = entry.trim();
    const lastColon = trimmed.lastIndexOf(":");
    if (lastColon === -1) {
      return { host: trimmed, port: 26379 };
    }
    const host = trimmed.slice(0, lastColon);
    const port = parseInt(trimmed.slice(lastColon + 1), 10);
    return { host, port: Number.isNaN(port) ? 26379 : port };
  });
}

/**
 * Extract the password from a Valkey/Redis URL.
 * Supports: "valkey://:password@host:port" and "redis://user:password@host:port"
 */
export function extractPasswordFromUrl(url: string): string | undefined {
  try {
    const redisUrl = url.replace(/^valkey:\/\//, "redis://");
    const parsed = new URL(redisUrl);
    return parsed.password || undefined;
  } catch {
    return undefined;
  }
}

let valkeyConnection: IORedis | null = null;

if (skipConnection) {
  console.warn("Valkey connection skipped (SKIP_VALKEY_CONNECTION=true).");
} else if (valkeySentinels) {
  // --- Sentinel mode ---
  const sentinels = parseSentinels(valkeySentinels);
  const masterPassword = valkeyUrl
    ? extractPasswordFromUrl(valkeyUrl)
    : undefined;

  valkeyConnection = new IORedis({
    sentinels,
    name: sentinelMasterName,
    ...(masterPassword && { password: masterPassword }),
    ...(sentinelPassword && { sentinelPassword }),
    ...baseOptions,
  });

  console.log(
    `Connecting to Valkey via Sentinel (master: "${sentinelMasterName}", sentinels: ${sentinels.map((s) => `${s.host}:${s.port}`).join(", ")})`
  );

  valkeyConnection.on("connect", () => {
    console.log("Successfully connected to Valkey master via Sentinel.");
  });

  valkeyConnection.on("error", (err) => {
    console.error("Valkey Sentinel connection error:", err);
  });

  valkeyConnection.on("reconnecting", () => {
    console.log("Valkey Sentinel: reconnecting to master...");
  });
} else if (valkeyUrl) {
  // --- Direct connection mode (existing behavior) ---
  const connectionUrl = valkeyUrl.replace(/^valkey:\/\//, "redis://");
  valkeyConnection = new IORedis(connectionUrl, baseOptions);

  valkeyConnection.on("connect", () => {
    console.log("Successfully connected to Valkey.");
  });

  valkeyConnection.on("error", (err) => {
    console.error("Valkey connection error:", err);
  });
} else {
  console.error(
    "VALKEY_URL environment variable is not set. Background jobs may fail."
  );
  console.warn("Valkey URL not provided. Valkey connection not established.");
}

export default valkeyConnection;
