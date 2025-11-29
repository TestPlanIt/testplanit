// Utility to group flat data by a list of keys (e.g., dimensions or categories)
export function groupRowsByKeys<T = any>(data: T[], keys: string[]): any[] {
  if (!keys.length) return data;
  const [first, ...rest] = keys;
  const groups: Record<string, T[]> = {};
  for (const row of data) {
    const r = row as Record<string, any>;
    const key =
      r[first] ||
      r[first?.toLowerCase?.()] ||
      r[first?.replace(/\s+/g, "").toLowerCase?.()] ||
      "(none)";
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return Object.entries(groups).map(([key, rows]) => ({
    key,
    rows: rest.length ? groupRowsByKeys(rows, rest) : rows,
  }));
}

// Utility to flatten grouped structure for rendering, with group/leaf info
export function flattenGroupedRows(
  grouped: any[],
  keys: string[],
  level = 0,
  parentKeys: string[] = []
): any[] {
  if (!keys.length) return grouped;
  const [first, ...rest] = keys;
  let rows: any[] = [];
  for (const group of grouped) {
    // Add group header row
    rows.push({
      __isGroup: true,
      __groupLevel: level,
      __groupKey: group.key,
      __parentKeys: parentKeys,
      [first]: group.key,
    });
    if (rest.length) {
      // Recurse for subgroups
      rows = rows.concat(
        flattenGroupedRows(group.rows, rest, level + 1, [
          ...parentKeys,
          group.key,
        ])
      );
    } else {
      // Leaf rows
      for (const row of group.rows) {
        rows.push({
          ...row,
          __isGroup: false,
          __groupLevel: level + 1,
          __parentKeys: [...parentKeys, group.key],
        });
      }
    }
  }
  return rows;
}
