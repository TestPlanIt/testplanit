/**
 * Shared state utilities for coordinating between the TestPlanIt WDIO service
 * and reporter instances running in separate worker processes.
 *
 * Uses a file in the OS temp directory to share state (test run ID, test suite ID)
 * between the main process (service) and worker processes (reporters).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Shared state file for coordinating between WDIO workers and the launcher service.
 *
 * When `managedByService` is true, the TestPlanItService controls the test run lifecycle
 * (creation in onPrepare, completion in onComplete). Workers must not manage the run lifecycle.
 *
 * When `managedByService` is false/absent, the reporter manages it (legacy oneReport mode).
 */
export interface SharedState {
  testRunId: number;
  testSuiteId?: number;
  createdAt: string;
  /** Number of active workers using this test run (only used when managedByService is false) */
  activeWorkers: number;
  /** When true, the TestPlanItService controls run creation/completion. Workers must not manage the run lifecycle. */
  managedByService?: boolean;
}

/** Maximum age of a shared state file before it is considered stale (4 hours) */
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

/**
 * Environment variable holding the ID of a test run created by the pipeline.
 * Every invocation that sees it attaches to that run instead of creating one,
 * which is how a suite split across shards, agents or retry waves lands in a
 * single run.
 */
export const RUN_ID_ENV_VAR = 'TESTPLANIT_RUN_ID';

/**
 * Parse a test run ID from an environment variable. Anything that isn't a
 * positive integer is ignored, so an unset or templated-but-unresolved variable
 * falls through to normal run resolution.
 */
export function parseEnvTestRunId(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : undefined;
}

/**
 * Get the path to the shared state file for a given project.
 * Uses the OS temp directory with a project-specific filename.
 */
export function getSharedStateFilePath(projectId: number): string {
  const fileName = `.testplanit-reporter-${projectId}.json`;
  return path.join(os.tmpdir(), fileName);
}

/**
 * Acquire a simple file-based lock using exclusive file creation.
 * Retries with exponential backoff up to `maxAttempts` times.
 */
function acquireLock(lockPath: string, maxAttempts = 10): boolean {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
      return true;
    } catch {
      const sleepMs = 50 * Math.pow(2, i) + Math.random() * 50;
      const start = Date.now();
      while (Date.now() - start < sleepMs) {
        // Busy wait
      }
    }
  }
  return false;
}

/**
 * Release a file-based lock.
 */
function releaseLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Ignore lock removal errors
  }
}

/**
 * Execute a callback while holding the lock on the shared state file.
 * Returns the callback's return value, or undefined if the lock could not be acquired.
 */
export function withLock<T>(projectId: number, callback: (filePath: string) => T): T | undefined {
  const filePath = getSharedStateFilePath(projectId);
  const lockPath = `${filePath}.lock`;

  if (!acquireLock(lockPath)) {
    return undefined;
  }

  try {
    return callback(filePath);
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * Read shared state from file.
 * Returns null if file doesn't exist, is stale (>4 hours), or contains invalid JSON.
 *
 * Note: Does NOT check `activeWorkers === 0` — that logic differs between
 * service-managed mode and legacy oneReport mode and is handled by the caller.
 */
export function readSharedState(projectId: number): SharedState | null {
  const filePath = getSharedStateFilePath(projectId);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const state: SharedState = JSON.parse(content);

    // Check if state is stale
    const createdAt = new Date(state.createdAt);
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
    if (createdAt < staleThreshold) {
      deleteSharedState(projectId);
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * Write shared state to file atomically (uses lock).
 */
export function writeSharedState(projectId: number, state: SharedState): void {
  withLock(projectId, (filePath) => {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  });
}

/**
 * Write shared state to file, but only if no file already exists (first writer wins).
 * If the file already exists, optionally updates the testSuiteId if not yet set.
 * Returns the final state (either the written state or the existing state).
 */
export function writeSharedStateIfAbsent(projectId: number, state: SharedState): SharedState | undefined {
  return withLock(projectId, (filePath) => {
    if (fs.existsSync(filePath)) {
      // File already exists — read existing state
      const content = fs.readFileSync(filePath, 'utf-8');
      const existingState: SharedState = JSON.parse(content);

      // Only update if the testSuiteId is missing and we have one to add
      if (!existingState.testSuiteId && state.testSuiteId) {
        existingState.testSuiteId = state.testSuiteId;
        fs.writeFileSync(filePath, JSON.stringify(existingState, null, 2));
      }
      return existingState;
    }

    // First writer — write the full state
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    return state;
  });
}

/**
 * Write shared state for a run whose ID was fixed before the run started
 * (externally pinned or service-managed).
 *
 * The state file is keyed by project, not by run, so a file left behind by an
 * earlier invocation can describe a different run. Such a file is replaced
 * rather than joined — unlike {@link writeSharedStateIfAbsent}, which resolves
 * a create race between workers that each minted their own run.
 *
 * Returns the final state for the run.
 */
export function writeSharedStateForRun(projectId: number, state: SharedState): SharedState | undefined {
  return withLock(projectId, (filePath) => {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const existingState: SharedState = JSON.parse(content);

        if (existingState.testRunId === state.testRunId) {
          if (!existingState.testSuiteId && state.testSuiteId) {
            existingState.testSuiteId = state.testSuiteId;
            fs.writeFileSync(filePath, JSON.stringify(existingState, null, 2));
          }
          return existingState;
        }
      } catch {
        // Unreadable state is replaced below
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    return state;
  });
}

/**
 * Delete shared state file.
 */
export function deleteSharedState(projectId: number): void {
  const filePath = getSharedStateFilePath(projectId);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore deletion errors
  }
}

/**
 * Atomically increment the active worker count in the shared state file.
 */
export function incrementWorkerCount(projectId: number): void {
  withLock(projectId, (filePath) => {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const state: SharedState = JSON.parse(content);
      state.activeWorkers = (state.activeWorkers || 0) + 1;
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    }
  });
}

/**
 * Atomically decrement the active worker count in the shared state file.
 * Returns true if this was the last worker (count reached 0).
 */
export function decrementWorkerCount(projectId: number): boolean {
  const result = withLock(projectId, (filePath) => {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const state: SharedState = JSON.parse(content);
      state.activeWorkers = Math.max(0, (state.activeWorkers || 1) - 1);
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
      return state.activeWorkers === 0;
    }
    return false;
  });
  return result ?? false;
}
