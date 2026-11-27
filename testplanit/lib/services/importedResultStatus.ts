import type { NormalizedStatus } from "./testResultsParser";

export interface ImportStatusCandidate {
  id: number;
  name: string;
  systemName: string;
  aliases: string | null;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
}

/**
 * Words an imported result is matched to a status by, most specific first.
 * An error is a failure, so it falls back to the failure words.
 */
const WORDS: Record<NormalizedStatus, string[]> = {
  passed: ["passed", "pass", "success"],
  failed: ["failed", "fail", "failure", "error"],
  error: ["error", "failed", "fail", "failure"],
  skipped: ["skipped", "skip", "ignored"],
};

const isFailure = (status: ImportStatusCandidate) =>
  status.isFailure && !status.isSuccess;

const HAS_FLAGS: Record<
  NormalizedStatus,
  (status: ImportStatusCandidate) => boolean
> = {
  passed: (status) => status.isSuccess && !status.isFailure,
  failed: isFailure,
  error: isFailure,
  skipped: (status) =>
    !status.isSuccess && !status.isFailure && status.isCompleted,
};

/**
 * Pick the status an imported result is recorded under.
 *
 * `statuses` are the statuses the import may use, in the admin's order. A
 * status that carries one of the result's words (as its system name, its name
 * or one of its aliases) wins, then one with an alias containing the word.
 * Statuses are admin-defined, so when none does, the first status whose flags
 * mean the same thing is used. Returns undefined when nothing fits: the result
 * is then stored without a status and counted by its JUnit type.
 *
 * The reporters resolve statuses by the same rules, in `getStatusId` of
 * packages/api.
 */
export function resolveImportedResultStatus<T extends ImportStatusCandidate>(
  statuses: T[],
  result: NormalizedStatus
): T | undefined {
  for (const word of WORDS[result]) {
    const found =
      statuses.find(
        (status) =>
          status.systemName.toLowerCase() === word ||
          status.name.toLowerCase() === word ||
          (status.aliases ?? "")
            .toLowerCase()
            .split(",")
            .some((alias) => alias.trim() === word)
      ) ??
      statuses.find((status) => status.aliases?.toLowerCase().includes(word));
    if (found) return found;
  }

  return statuses.find(HAS_FLAGS[result]);
}
