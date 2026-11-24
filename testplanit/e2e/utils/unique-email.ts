/**
 * An email address no other test can produce, even one that starts in the
 * same millisecond in another browser project.
 */
export function uniqueEmail(prefix: string, domain = "example.com"): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${suffix}@${domain}`;
}
