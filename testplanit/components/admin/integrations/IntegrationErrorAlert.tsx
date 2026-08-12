"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

/**
 * Renders a connection failure returned by the integration API.
 *
 * The message comes from the server as prose (see lib/integrations/errors.ts)
 * and may name a URL the admin has to visit — an API token page, for example.
 * A toast is the wrong container for that, so it is rendered inline and the
 * URL is made clickable.
 */
export function IntegrationErrorAlert({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Alert variant="destructive" data-testid="integration-error-alert">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p className="whitespace-pre-line">{linkify(message)}</p>
      </AlertDescription>
    </Alert>
  );
}

// Split keeps the capture group; the test pattern is a separate, non-global
// copy because `lastIndex` on a global regex makes repeated `.test()` calls
// alternate between true and false.
const URL_SPLIT_PATTERN = /(https?:\/\/[^\s)]+)/g;
const URL_TEST_PATTERN = /^https?:\/\/[^\s)]+$/;

function linkify(message: string) {
  return message.split(URL_SPLIT_PATTERN).map((part, index) =>
    URL_TEST_PATTERN.test(part) ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2"
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}
