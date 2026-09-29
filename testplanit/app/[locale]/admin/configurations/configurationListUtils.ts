/**
 * Pure helpers for the admin configuration list, kept out of the column
 * definitions so they can be unit tested without rendering the table.
 */

/** Variants in category-name order, the order the Add wizard lists them. */
export function sortVariantsByCategory<
  T extends { variant: { name: string; category?: { name: string } } },
>(variants: T[]): T[] {
  return [...variants].sort(
    (a, b) =>
      (a.variant.category?.name ?? "").localeCompare(
        b.variant.category?.name ?? ""
      ) || a.variant.name.localeCompare(b.variant.name)
  );
}

/**
 * Whether a configuration matches the list filter. Every whitespace-separated
 * term has to appear in the configuration name or in one of its variant
 * names, so a configuration can be found by its variants even when its name
 * was edited or no longer spells them.
 */
export function configurationMatchesSearch(
  config: { name: string; variants: { variant: { name: string } }[] },
  search: string
): boolean {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [config.name, ...config.variants.map((v) => v.variant.name)]
    .join("\n")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
