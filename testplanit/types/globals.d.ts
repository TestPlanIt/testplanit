import dynamicIconImports from "lucide-react/dynamicIconImports";

export type IconName = keyof typeof dynamicIconImports;

declare global {
  interface Window {
    /**
     * Active onboarding tour name, set by NextStepOnboarding. Used as a global
     * flag (instead of URL params, which navigation can strip) so other views
     * can avoid actions that would close the tour overlay. Persists across
     * client-side navigation; cleared on page refresh.
     */
    __activeTour?: string | null;
  }
}
