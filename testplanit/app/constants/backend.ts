/**
 * Backend-safe constants that can be used in workers and server-side code
 * This file should NOT import any frontend dependencies like lucide-react
 */

export const emptyEditorContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
};

export const themeColors = [
  "#fb7185",
  "#fdba74",
  "#d9f99d",
  "#a7f3d0",
  "#a5f3fc",
  "#a5b4fc",
];

export const MAX_DURATION = 60 * 60 * 24 * 366 - 18 * 60 * 60; // 1 year + 1 day - 18 hours to account for leap years
