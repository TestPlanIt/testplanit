import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface IssueObject {
  id: number;
  name: string;
  externalId?: string | null;
}

export function determineIssueDifferences(
  current: IssueObject[],
  previous: IssueObject[]
) {
  // Ensure inputs are arrays
  const currentIssues = Array.isArray(current) ? current : [];
  const previousIssues = Array.isArray(previous) ? previous : [];

  // Create sets of IDs for efficient lookup
  const currentIds = new Set(currentIssues.map((issue) => issue.id));
  const previousIds = new Set(previousIssues.map((issue) => issue.id));

  // Find differences based on IDs
  const addedIssues = currentIssues.filter(
    (issue) => !previousIds.has(issue.id)
  );
  const removedIssues = previousIssues.filter(
    (issue) => !currentIds.has(issue.id)
  );
  const commonIssues = currentIssues.filter((issue) =>
    previousIds.has(issue.id)
  );

  return { addedIssues, removedIssues, commonIssues };
}
