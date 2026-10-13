/** Caps applied to every provider compare. Hitting any of them sets `truncated`. */
export const MAX_COMPARE_FILES = 500;
export const MAX_FILES_WITH_PATCH = 300;
export const MAX_PATCH_BYTES_PER_FILE = 100_000;
export const MAX_TOTAL_PATCH_BYTES = 2_000_000;
export const MAX_COMPARE_COMMITS = 250;
/** Local-diff fallback (providers with no file-diff endpoint). */
export const MAX_LOCAL_DIFF_FILES = 100;
export const MAX_LOCAL_DIFF_FILE_BYTES = 512_000;
/** Single-file reads at a commit (code viewer, pin anchoring). */
export const MAX_FILE_AT_COMMIT_BYTES = 1_000_000;
