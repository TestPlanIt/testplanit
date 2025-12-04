const DEFAULT_LENGTH = 16;
const CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";

/**
 * Generate an unbiased random index using rejection sampling.
 * This avoids modulo bias by rejecting values that would cause uneven distribution.
 */
function getUnbiasedIndex(randomValue: number, max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  if (randomValue < limit) {
    return randomValue % max;
  }
  return -1; // Signal to retry
}

export const generateRandomPassword = (length = DEFAULT_LENGTH): string => {
  const targetLength = Math.max(8, length);
  const hasCrypto =
    typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues;

  const result: string[] = [];

  if (hasCrypto) {
    const charsetLength = CHARSET.length;
    while (result.length < targetLength) {
      const needed = targetLength - result.length;
      const values = globalThis.crypto.getRandomValues(new Uint32Array(needed));
      for (let i = 0; i < needed && result.length < targetLength; i += 1) {
        const index = getUnbiasedIndex(values[i], charsetLength);
        if (index >= 0) {
          result.push(CHARSET[index]);
        }
      }
    }
    return result.join("");
  }

  for (let i = 0; i < targetLength; i += 1) {
    const index = Math.floor(Math.random() * CHARSET.length);
    result.push(CHARSET[index]);
  }
  return result.join("");
};
