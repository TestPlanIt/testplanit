import { ShareLinkMode } from "@prisma/client";

/**
 * Filters sensitive data from report results for public and password-protected shares
 * Authenticated shares with project access get full data
 */

/**
 * Filter sensitive user information from report data
 * @param data - Report data to filter
 * @param mode - Share link mode
 * @returns Filtered report data
 */
export function filterSensitiveReportData(
  data: any,
  mode: ShareLinkMode
): any {
  // Authenticated users with project access get full data
  if (mode === "AUTHENTICATED") {
    return data;
  }

  // For PUBLIC and PASSWORD_PROTECTED, filter sensitive information
  if (!data) return data;

  // Handle array of results
  if (Array.isArray(data)) {
    return data.map((item) => filterSensitiveItem(item));
  }

  // Handle single object
  if (typeof data === "object") {
    return filterSensitiveItem(data);
  }

  return data;
}

/**
 * Filter sensitive fields from a single data item
 */
function filterSensitiveItem(item: any): any {
  if (!item || typeof item !== "object") {
    return item;
  }

  const filtered = { ...item };

  // Filter user information
  if (filtered.user && typeof filtered.user === "object") {
    filtered.user = {
      ...filtered.user,
      // Replace email with generic identifier
      email: undefined,
      // Keep name but could be anonymized if needed
      name: filtered.user.name || "User",
      // Remove internal IDs if present
      id: undefined,
    };
  }

  // Filter executor information (for test execution reports)
  if (filtered.executedBy && typeof filtered.executedBy === "object") {
    filtered.executedBy = {
      ...filtered.executedBy,
      email: undefined,
      name: filtered.executedBy.name || "User",
      id: undefined,
    };
  }

  // Filter assignee information
  if (filtered.assignedTo && typeof filtered.assignedTo === "object") {
    filtered.assignedTo = {
      ...filtered.assignedTo,
      email: undefined,
      name: filtered.assignedTo.name || "User",
      id: undefined,
    };
  }

  // Remove IP addresses if present
  if (filtered.ipAddress) {
    delete filtered.ipAddress;
  }

  // Remove internal system IDs (keep display IDs)
  if (filtered.internalId) {
    delete filtered.internalId;
  }

  // Remove audit trail data
  if (filtered.auditLog) {
    delete filtered.auditLog;
  }

  // Remove integration credentials
  if (filtered.integrationConfig) {
    delete filtered.integrationConfig;
  }

  if (filtered.apiKey) {
    delete filtered.apiKey;
  }

  if (filtered.apiToken) {
    delete filtered.apiToken;
  }

  // Recursively filter nested objects
  for (const key in filtered) {
    if (filtered[key] && typeof filtered[key] === "object") {
      if (Array.isArray(filtered[key])) {
        filtered[key] = filtered[key].map((nestedItem: any) =>
          typeof nestedItem === "object"
            ? filterSensitiveItem(nestedItem)
            : nestedItem
        );
      } else {
        filtered[key] = filterSensitiveItem(filtered[key]);
      }
    }
  }

  return filtered;
}

/**
 * Anonymize user names in report data
 * Useful for highly sensitive public shares
 * @param data - Report data
 * @returns Data with anonymized user names
 */
export function anonymizeUserNames(data: any): any {
  const userMap = new Map<string, string>();
  let userCounter = 1;

  function getAnonymousName(originalName: string): string {
    if (!userMap.has(originalName)) {
      userMap.set(originalName, `User ${userCounter++}`);
    }
    return userMap.get(originalName)!;
  }

  function anonymizeItem(item: any): any {
    if (!item || typeof item !== "object") {
      return item;
    }

    const anonymized = { ...item };

    // Anonymize user names
    if (anonymized.user?.name) {
      anonymized.user.name = getAnonymousName(anonymized.user.name);
    }

    if (anonymized.executedBy?.name) {
      anonymized.executedBy.name = getAnonymousName(anonymized.executedBy.name);
    }

    if (anonymized.assignedTo?.name) {
      anonymized.assignedTo.name = getAnonymousName(anonymized.assignedTo.name);
    }

    if (anonymized.createdBy?.name) {
      anonymized.createdBy.name = getAnonymousName(anonymized.createdBy.name);
    }

    // Recursively anonymize nested objects
    for (const key in anonymized) {
      if (anonymized[key] && typeof anonymized[key] === "object") {
        if (Array.isArray(anonymized[key])) {
          anonymized[key] = anonymized[key].map((nestedItem: any) =>
            typeof nestedItem === "object"
              ? anonymizeItem(nestedItem)
              : nestedItem
          );
        } else {
          anonymized[key] = anonymizeItem(anonymized[key]);
        }
      }
    }

    return anonymized;
  }

  if (Array.isArray(data)) {
    return data.map((item) => anonymizeItem(item));
  }

  return anonymizeItem(data);
}
