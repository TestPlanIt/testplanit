// Shared contract between the OAuth popup's landing page
// (/integrations/auth-complete) and the dialogs that open the popup. The
// landing page posts this message to its opener so the dialog can clear its
// auth-required state without a manual refresh.
export const INTEGRATION_AUTH_COMPLETE_MESSAGE_TYPE =
  "testplanit:integration-auth-complete";

export interface IntegrationAuthCompleteMessage {
  type: typeof INTEGRATION_AUTH_COMPLETE_MESSAGE_TYPE;
  success: boolean;
}

export function isIntegrationAuthCompleteMessage(
  event: MessageEvent
): event is MessageEvent<IntegrationAuthCompleteMessage> {
  return (
    event.origin === window.location.origin &&
    (event.data as IntegrationAuthCompleteMessage | null)?.type ===
      INTEGRATION_AUTH_COMPLETE_MESSAGE_TYPE
  );
}
