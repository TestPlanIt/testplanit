import { NextResponse, type NextRequest } from "next/server";
import { getCspMode } from "~/lib/contentSecurityPolicy";
import { recordCspViolation, type CspViolation } from "~/lib/cspReportLog";

export const dynamic = "force-dynamic";

/** Browsers send at most a few KB per report; anything larger is not one. */
const MAX_BODY_BYTES = 16 * 1024;

type ViolationSummary = CspViolation;

/**
 * Both report shapes browsers send: the legacy `report-uri` body
 * (`{"csp-report": {...}}`, kebab-case keys) and the Reporting API body
 * (an array of `{type: "csp-violation", body: {...}}`, camelCase keys).
 */
function summarize(payload: unknown): ViolationSummary[] {
  const items: any[] = Array.isArray(payload) ? payload : [payload];
  return items
    .map((item) => {
      const r = item?.["csp-report"] ?? item?.body ?? item;
      if (!r || typeof r !== "object") return null;
      const summary: ViolationSummary = {
        documentUri: r.documentURL ?? r["document-uri"],
        violatedDirective:
          r.effectiveDirective ??
          r["effective-directive"] ??
          r["violated-directive"],
        blockedUri: r.blockedURL ?? r["blocked-uri"],
        sourceFile: r.sourceFile ?? r["source-file"],
        line: r.lineNumber ?? r["line-number"],
        column: r.columnNumber ?? r["column-number"],
        sample: r.sample ?? r["script-sample"],
        disposition: r.disposition,
      };
      return summary.violatedDirective ? summary : null;
    })
    .filter((s): s is ViolationSummary => s !== null);
}

/**
 * Where browsers send Content-Security-Policy violation reports. Each distinct
 * violation becomes a log line (repeats are counted, not repeated), so an
 * instance running in report-only mode shows in its server log exactly what
 * an enforced policy would have blocked.
 */
export async function POST(request: NextRequest) {
  if (getCspMode() === "off") {
    return new NextResponse(null, { status: 204 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    payload = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  for (const violation of summarize(payload)) {
    recordCspViolation(violation);
  }

  return new NextResponse(null, { status: 204 });
}
