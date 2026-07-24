import { Link as LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Renders the destination's `/favicon.ico` as a small preview for an external
 * link, falling back to the generic link icon when the fetch fails (404,
 * mixed content, broken URL, etc). Browser-side only — the URL never touches
 * our server, so internal-only hostnames (e.g. confluence.internal.*) stay
 * private. We don't proxy through a third party (Google/DuckDuckGo)
 * specifically to avoid that domain leak.
 */
export function LinkFavicon({
  url,
  className,
}: {
  url: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);

  // Reset when the URL changes so a new link can re-attempt favicon load.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  let iconUrl: string | null = null;
  if (!failed) {
    try {
      iconUrl = `${new URL(url).origin}/favicon.ico`;
    } catch {
      iconUrl = null;
    }
  }
  if (!iconUrl) {
    return (
      <LinkIcon className={`${className} text-muted-foreground shrink-0`} />
    );
  }
  return (
    // Raw <img> is intentional: next/image would proxy the favicon through our
    // optimizer, defeating the privacy design above (internal hostnames must
    // never touch the server) and requiring remotePatterns for arbitrary origins.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      alt=""
      className={`${className} shrink-0 rounded-sm object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
