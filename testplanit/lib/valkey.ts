import IORedis from "ioredis";

// Check if we should skip Valkey connection (useful during build)
const skipConnection = process.env.SKIP_VALKEY_CONNECTION === "true";

// Get Valkey URL from environment
const valkeyUrl = process.env.VALKEY_URL;

if (!valkeyUrl && !skipConnection) {
  // Log an error, but maybe don't throw immediately
  // depending on whether Valkey is strictly required at startup
  console.error(
    "VALKEY_URL environment variable is not set. Background jobs may fail."
  );
  // Optional: throw new Error('VALKEY_URL environment variable is not set.');
}

// Configure the connection options
const connectionOptions = {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false, // Optional: Sometimes helps with startup race conditions
};

let valkeyConnection: IORedis | null = null;

if (valkeyUrl && !skipConnection) {
  // Convert valkey:// to redis:// for ioredis compatibility
  // ioredis expects redis:// protocol but we're connecting to Valkey
  const connectionUrl = valkeyUrl.replace(/^valkey:\/\//, 'redis://');
  
  // Create and export the connection instance only if URL is provided
  valkeyConnection = new IORedis(connectionUrl, connectionOptions);

  valkeyConnection.on("connect", () => {
    console.log("Successfully connected to Valkey.");
  });

  valkeyConnection.on("error", (err) => {
    console.error("Valkey connection error:", err);
  });
} else {
  console.warn("Valkey URL not provided. Valkey connection not established.");
}

export default valkeyConnection;