import { PlayCircle, Compass, ListChecks } from "lucide-react";

// Re-export backend-safe constants
export { emptyEditorContent, themeColors, MAX_DURATION } from "./backend";

export const scopeDisplayData = {
  CASES: {
    text: "Test Cases",
    icon: ListChecks,
  },
  RUNS: {
    text: "Test Runs",
    icon: PlayCircle,
  },
  SESSIONS: {
    text: "Sessions",
    icon: Compass,
  },
};
