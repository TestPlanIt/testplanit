import { Brain, Sparkles, Zap } from "lucide-react";

/**
 * Shared LLM provider badge colors and icons.
 * Used in admin LLM table and project settings LLM cards.
 */

export const LLM_PROVIDER_COLORS: Record<string, string> = {
  OPENAI:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  ANTHROPIC:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  AZURE_OPENAI:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  GEMINI:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  OLLAMA:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  CUSTOM_LLM:
    "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const DEFAULT_COLOR =
  "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";

export function getProviderColor(provider: string): string {
  return LLM_PROVIDER_COLORS[provider] || DEFAULT_COLOR;
}

export function getProviderIcon(
  provider: string,
  className = "h-5 w-5"
): React.ReactNode {
  switch (provider) {
    case "OPENAI":
      return <Brain className={`${className} text-green-600`} />;
    case "ANTHROPIC":
      return <Sparkles className={`${className} text-orange-600`} />;
    case "AZURE_OPENAI":
      return <Zap className={`${className} text-blue-600`} />;
    case "GEMINI":
      return <Sparkles className={`${className} text-indigo-500`} />;
    case "OLLAMA":
      return <Sparkles className={`${className} text-purple-600`} />;
    case "CUSTOM_LLM":
      return <Brain className={`${className} text-gray-600`} />;
    default:
      return <Sparkles className={`${className} text-gray-600`} />;
  }
}
