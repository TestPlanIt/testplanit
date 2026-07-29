import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// We need to test the actual module, so we mock fs at a low level
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import {
  getSharedStateFilePath,
  readSharedState,
  writeSharedState,
  writeSharedStateIfAbsent,
  writeSharedStateForRun,
  deleteSharedState,
  incrementWorkerCount,
  decrementWorkerCount,
  withLock,
  type SharedState,
} from './shared.js';

const mockedFs = vi.mocked(fs);

describe('shared utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getSharedStateFilePath', () => {
    it('should return path in os.tmpdir() with projectId', () => {
      const result = getSharedStateFilePath(42);
      expect(result).toBe(path.join(os.tmpdir(), '.testplanit-reporter-42.json'));
    });

    it('should handle different projectId values', () => {
      const result1 = getSharedStateFilePath(1);
      const result2 = getSharedStateFilePath(999);
      expect(result1).toContain('-1.json');
      expect(result2).toContain('-999.json');
      expect(result1).not.toBe(result2);
    });
  });

  describe('readSharedState', () => {
    it('should return null when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);
      expect(readSharedState(1)).toBeNull();
    });

    it('should return parsed state when file exists and is valid', () => {
      const state: SharedState = {
        testRunId: 123,
        testSuiteId: 456,
        createdAt: new Date().toISOString(),
        activeWorkers: 2,
      };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(state));

      const result = readSharedState(1);
      expect(result).toEqual(state);
    });

    it('should return null and delete file when state is stale (>4 hours)', () => {
      const staleDate = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
      const state: SharedState = {
        testRunId: 123,
        createdAt: staleDate.toISOString(),
        activeWorkers: 1,
      };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(state));

      const result = readSharedState(1);
      expect(result).toBeNull();
      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });

    it('should return null when file contains invalid JSON', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('not valid json');

      const result = readSharedState(1);
      expect(result).toBeNull();
    });

    it('should return state even when activeWorkers is 0', () => {
      // readSharedState no longer checks activeWorkers — caller handles this
      const state: SharedState = {
        testRunId: 123,
        createdAt: new Date().toISOString(),
        activeWorkers: 0,
      };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(state));

      const result = readSharedState(1);
      expect(result).toEqual(state);
    });

    it('should return state with managedByService flag', () => {
      const state: SharedState = {
        testRunId: 123,
        testSuiteId: 456,
        createdAt: new Date().toISOString(),
        activeWorkers: 0,
        managedByService: true,
      };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(state));

      const result = readSharedState(1);
      expect(result).toEqual(state);
      expect(result?.managedByService).toBe(true);
    });
  });

  describe('writeSharedState', () => {
    it('should write state to file', () => {
      // Lock file doesn't exist (can acquire)
      mockedFs.writeFileSync.mockImplementation(() => {});

      const state: SharedState = {
        testRunId: 123,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      writeSharedState(1, state);

      // Should have written lock file and then state file
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('writeSharedStateIfAbsent', () => {
    it('should write state when file does not exist', () => {
      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(false);

      const state: SharedState = {
        testRunId: 123,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      const result = writeSharedStateIfAbsent(1, state);
      expect(result).toEqual(state);
    });

    it('should return existing state when file already exists', () => {
      const existingState: SharedState = {
        testRunId: 100,
        testSuiteId: 200,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingState));

      const newState: SharedState = {
        testRunId: 999,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      const result = writeSharedStateIfAbsent(1, newState);
      expect(result?.testRunId).toBe(100); // Should return existing, not new
    });

    it('should update testSuiteId if not set in existing state', () => {
      const existingState: SharedState = {
        testRunId: 100,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
        // No testSuiteId
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingState));

      const newState: SharedState = {
        testRunId: 100,
        testSuiteId: 456,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      const result = writeSharedStateIfAbsent(1, newState);
      expect(result?.testSuiteId).toBe(456);
    });
  });

  describe('writeSharedStateForRun', () => {
    it('should write state when file does not exist', () => {
      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(false);

      const state: SharedState = {
        testRunId: 984,
        testSuiteId: 10,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      const result = writeSharedStateForRun(1, state);
      expect(result).toEqual(state);
    });

    it('should join existing state for the same run', () => {
      const existingState: SharedState = {
        testRunId: 984,
        testSuiteId: 200,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingState));

      const result = writeSharedStateForRun(1, {
        testRunId: 984,
        testSuiteId: 999,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      });

      expect(result?.testSuiteId).toBe(200);
    });

    it('should adopt the incoming suite when the same run has none recorded', () => {
      const existingState: SharedState = {
        testRunId: 984,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingState));

      const result = writeSharedStateForRun(1, {
        testRunId: 984,
        testSuiteId: 999,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      });

      expect(result?.testSuiteId).toBe(999);
    });

    it('should replace state left behind by a different run', () => {
      const existingState: SharedState = {
        testRunId: 500,
        testSuiteId: 200,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(existingState));

      const newState: SharedState = {
        testRunId: 984,
        testSuiteId: 999,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      const result = writeSharedStateForRun(1, newState);
      expect(result).toEqual(newState);
    });

    it('should replace unreadable state', () => {
      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('not json');

      const newState: SharedState = {
        testRunId: 984,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      const result = writeSharedStateForRun(1, newState);
      expect(result).toEqual(newState);
    });
  });

  describe('deleteSharedState', () => {
    it('should delete file when it exists', () => {
      mockedFs.existsSync.mockReturnValue(true);
      deleteSharedState(1);
      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });

    it('should do nothing when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);
      deleteSharedState(1);
      expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('incrementWorkerCount', () => {
    it('should increment activeWorkers by 1', () => {
      const state: SharedState = {
        testRunId: 123,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(state));

      incrementWorkerCount(1);

      // Find the write call that writes the updated state (not the lock file)
      const writeCalls = mockedFs.writeFileSync.mock.calls;
      const stateWriteCall = writeCalls.find(
        (call) => typeof call[1] === 'string' && call[1].includes('"activeWorkers": 2')
      );
      expect(stateWriteCall).toBeTruthy();
    });
  });

  describe('decrementWorkerCount', () => {
    it('should decrement activeWorkers by 1 and return false when count > 0', () => {
      const state: SharedState = {
        testRunId: 123,
        createdAt: new Date().toISOString(),
        activeWorkers: 2,
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(state));

      const result = decrementWorkerCount(1);
      expect(result).toBe(false);
    });

    it('should return true when count reaches 0', () => {
      const state: SharedState = {
        testRunId: 123,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(state));

      const result = decrementWorkerCount(1);
      expect(result).toBe(true);
    });

    it('should not go below 0', () => {
      const state: SharedState = {
        testRunId: 123,
        createdAt: new Date().toISOString(),
        activeWorkers: 0,
      };

      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(state));

      const result = decrementWorkerCount(1);
      expect(result).toBe(true); // 0 -> 0, still returns true

      const writeCalls = mockedFs.writeFileSync.mock.calls;
      const stateWriteCall = writeCalls.find(
        (call) => typeof call[1] === 'string' && call[1].includes('"activeWorkers": 0')
      );
      expect(stateWriteCall).toBeTruthy();
    });

    it('should return false when file does not exist', () => {
      mockedFs.writeFileSync.mockImplementation(() => {});
      mockedFs.existsSync.mockReturnValue(false);

      const result = decrementWorkerCount(1);
      expect(result).toBe(false);
    });
  });

  describe('withLock', () => {
    it('should return undefined when lock cannot be acquired', () => {
      // Make writeFileSync always throw for the lock file (simulates lock contention)
      mockedFs.writeFileSync.mockImplementation((_path, _data, options) => {
        if (options && typeof options === 'object' && 'flag' in options && options.flag === 'wx') {
          throw new Error('EEXIST: file already exists');
        }
      });

      // Speed up busy-wait by making Date.now() jump forward each call
      let time = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        time += 100000; // Jump far ahead each call to exit busy-wait instantly
        return time;
      });

      try {
        const callback = vi.fn().mockReturnValue('should not be called');
        const result = withLock(1, callback);

        expect(result).toBeUndefined();
        expect(callback).not.toHaveBeenCalled();
      } finally {
        vi.mocked(Date.now).mockRestore();
      }
    });

    it('should execute callback when lock is acquired', () => {
      mockedFs.writeFileSync.mockImplementation(() => {});

      const callback = vi.fn().mockReturnValue('success');
      const result = withLock(1, callback);

      expect(result).toBe('success');
      expect(callback).toHaveBeenCalled();
    });

    it('should release lock even when callback throws', () => {
      mockedFs.writeFileSync.mockImplementation(() => {});

      const callback = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });

      expect(() => withLock(1, callback)).toThrow('callback error');
      // unlinkSync should be called to release the lock
      expect(mockedFs.unlinkSync).toHaveBeenCalled();
    });
  });
});
