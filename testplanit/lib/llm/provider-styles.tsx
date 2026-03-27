import { Badge } from "@/components/ui/badge";
import { Brain, Sparkles, Zap } from "lucide-react";
import { cn } from "~/utils";

/**
 * Shared LLM provider badge colors and icons.
 * Used in admin LLM table, project settings LLM cards, and admin projects table.
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

interface LlmProviderBadgeProps {
  provider: string;
  name?: string;
  showIcon?: boolean;
  iconSize?: string;
  className?: string;
}

export function LlmProviderBadge({
  provider,
  name,
  showIcon = false,
  iconSize = "h-3 w-3",
  className,
}: LlmProviderBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(getProviderColor(provider), className)}
    >
      {showIcon && (
        <span className="mr-1 shrink-0">{getProviderIcon(provider, iconSize)}</span>
      )}
      {name ?? provider.replace("_", " ")}
    </Badge>
  );
}
