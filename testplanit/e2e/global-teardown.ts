import fs from "fs";
import path from "path";

const WORKERS_PID_FILE = path.join(__dirname, ".auth", "workers.pid");

/**
 * Stop the BullMQ workers spawned by global-setup. Kills the entire process
 * group (negative PID) so that the `pnpm workers` parent and all of its
 * `concurrently`-spawned children are terminated, not just the parent —
 * otherwise the per-worker `tsx` processes outlive the test run and bind
 * Redis connections / file descriptors.
 */
async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(WORKERS_PID_FILE)) return;
  const raw = fs.readFileSync(WORKERS_PID_FILE, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    fs.rmSync(WORKERS_PID_FILE, { force: true });
    return;
  }
  try {
    // Negative PID targets the process group spawned by detached:true.
    process.kill(-pid, "SIGTERM");
    console.log(`Sent SIGTERM to workers process group (pgid=${pid})`);
  } catch (err) {
    // ESRCH: process group already gone (clean exit).
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
      console.error("Failed to stop workers process group:", err);
    }
  } finally {
    fs.rmSync(WORKERS_PID_FILE, { force: true });
  }
}

export default globalTeardown;
