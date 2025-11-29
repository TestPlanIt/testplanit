const DEFAULT_LENGTH = 16;
const CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";

export const generateRandomPassword = (length = DEFAULT_LENGTH): string => {
  const targetLength = Math.max(8, length);
  const values =
    typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(targetLength))
      : null;

  const result: string[] = [];

  if (values) {
    for (let i = 0; i < targetLength; i += 1) {
      const index = values[i] % CHARSET.length;
      result.push(CHARSET[index]);
    }
    return result.join("");
  }

  for (let i = 0; i < targetLength; i += 1) {
    const index = Math.floor(Math.random() * CHARSET.length);
    result.push(CHARSET[index]);
  }
  return result.join("");
};
