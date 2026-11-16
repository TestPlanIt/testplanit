/**
 * Storage scan vocabulary shared by the scan service, its routes and the
 * Storage view on Admin > Attachments. Kept free of server imports so the
 * page can load it in the browser.
 */

/** The only part of the bucket the app writes to and the scan looks at. */
export const STORAGE_ROOT = "uploads/";

export const STORAGE_OBJECT_STATUSES = ["ORPHAN", "REFERENCED"] as const;
export type StorageObjectStatus = (typeof STORAGE_OBJECT_STATUSES)[number];

/** The folder an object key lives in: its first two path segments. */
export function storageFolderOf(key: string): string {
  const parts = key.split("/");
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? "");
}

/** Where an object stands, given whether anything refers to it. */
export function classifyStorageObject(
  referenced: boolean
): StorageObjectStatus {
  return referenced ? "REFERENCED" : "ORPHAN";
}

/**
 * The storage keys named anywhere in `text`. Rich text and version snapshots
 * store a file as a URL, in any of the shapes a storage URL takes, and all of
 * them end in the object key.
 *
 * A key may hold spaces and a URL may be followed by more text, so each
 * mention is read two ways (up to the closing quote, and up to the first
 * space or bracket) and both are returned, as written and decoded. Reading
 * too much only adds a string no object is named; reading too little would
 * call a file in use an orphan.
 */
export function storageKeysIn(text: string): string[] {
  const keys = new Set<string>();
  const add = (value: string) => {
    keys.add(value);
    try {
      keys.add(decodeURIComponent(value));
    } catch {
      // Not valid encoding: the key as written is all there is.
    }
  };
  for (const match of text.matchAll(/uploads\/[^"'\\<>?#]+/g)) {
    add(match[0]);
    const short = match[0].match(/^[^\s)\]]+/);
    if (short) add(short[0]);
  }
  return [...keys];
}
