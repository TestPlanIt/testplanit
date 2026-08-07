import { Loader2 } from "lucide-react";

// Page-area fallback: shown inside the app chrome while a page segment loads
// (page-load prerender shell and cross-route client navigations). Keeping this
// at the segment level — instead of a Suspense boundary wrapping the whole
// layout — is what keeps the header visible and dialog state alive during
// same-route URL syncs.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
