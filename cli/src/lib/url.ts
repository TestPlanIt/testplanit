/**
 * Joins an API path onto the configured server URL. A plain string join, not
 * `new URL(path, base)`: a root-relative path would discard any path prefix
 * the server is installed under (https://host/testplanit).
 */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}
