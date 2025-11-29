import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toHumanReadable } from "~/utils/duration";

/**
 * Format seconds into a human-readable duration string using humanize-duration.
 * @param seconds - The number of seconds to format
 * @param locale - Optional locale string (e.g., "en-US", "es-ES")
 * @param round - Optional flag to round the output (default: true)
 * @returns Formatted duration string
 */
export const formatSeconds = (
  seconds: number,
  locale?: string,
  round: boolean = true
) => {
  if (seconds === 0) {
    // humanize-duration doesn't handle 0 nicely, return specific string
    // We need the translation hook here, or pass the translated string
    // For now, let's return a placeholder. We'll handle translation in the component.
    return "0 seconds"; // Placeholder, will be handled by component
  }
  return toHumanReadable(seconds, {
    isSeconds: true,
    round: round,
    locale: locale,
  });
};

// React component for use in JSX
type DurationDisplayProps = {
  seconds: number | null | undefined; // Allow null/undefined props
  round?: boolean; // Optional prop to control rounding
};

export const DurationDisplay: React.FC<DurationDisplayProps> = ({
  seconds,
  round = true, // Default rounding to true
}) => {
  const locale = useLocale();
  const t = useTranslations("common.labels");

  if (seconds === null || seconds === undefined) {
    return null;
  }

  // Explicitly check for 0 and return localized string
  if (seconds === 0) {
    return <>{t("noElapsedTime")}</>;
  }

  // Otherwise, format the duration using the refactored formatSeconds
  const formattedDuration = formatSeconds(seconds, locale, round);

  return <>{formattedDuration}</>;
};
