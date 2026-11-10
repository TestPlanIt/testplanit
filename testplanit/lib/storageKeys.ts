function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Map a stored file URL (an attachment's `url`, an editor media `src`) to an
 * object key in this instance's storage bucket, or null when the URL does not
 * point at our storage. Recognized shapes:
 *  - `/api/storage/<key>` — the storage proxy route (relative or absolute,
 *    with or without a base path)
 *  - `<endpoint>/<bucket>/<key>` — path-style presigned upload against the
 *    configured public or internal endpoint
 *  - `https://<bucket>.s3.<region>.amazonaws.com/<key>` — virtual-hosted AWS
 */
export function storageKeyForSrc(src: string): string | null {
  const proxyMarker = "/api/storage/";
  const proxyIndex = src.indexOf(proxyMarker);
  if (proxyIndex !== -1) {
    const key = src.slice(proxyIndex + proxyMarker.length).split(/[?#]/)[0];
    return key ? safeDecode(key) : null;
  }

  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket || !/^https?:\/\//i.test(src)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  const pathname = safeDecode(url.pathname).replace(/^\/+/, "");

  const endpointOrigins = [
    process.env.AWS_PUBLIC_ENDPOINT_URL,
    process.env.AWS_ENDPOINT_URL,
  ]
    .filter((endpoint): endpoint is string => Boolean(endpoint))
    .map((endpoint) => {
      try {
        return new URL(endpoint).origin;
      } catch {
        return null;
      }
    });
  if (endpointOrigins.includes(url.origin)) {
    return pathname.startsWith(`${bucket}/`)
      ? pathname.slice(bucket.length + 1)
      : pathname;
  }

  if (
    url.hostname.startsWith(`${bucket}.`) &&
    url.hostname.endsWith(".amazonaws.com")
  ) {
    return pathname;
  }

  return null;
}
