"use client";

import LoadingSpinner from "@/components/LoadingSpinner";
import { ChevronLeft, ChevronRight, Download, File } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OfficeKind } from "~/lib/utils/officeDocuments";
import { cn } from "~/utils";
import styles from "./OfficeDocumentPreview.module.css";

/** Files above this size fall back to a download link instead of being parsed
 * in the browser, so a very large document can't freeze the tab. */
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

type PreviewStatus = "loading" | "ready" | "error" | "tooLarge" | "empty";

interface OfficeDocumentPreviewProps {
  fileURL: string;
  name: string;
  kind: OfficeKind;
  size?: "small" | "medium" | "large";
  sizeBytes?: number | bigint | null;
}

/**
 * Renders a client-side preview of a Microsoft Office document. Word and Excel
 * files render into a container element (docx-preview / SheetJS HTML);
 * PowerPoint renders slide-by-slide to a canvas (pptxviewjs). All renderers are
 * lazily imported so they never enter the main bundle or run during SSR.
 *
 * Only `size="large"` (details page + carousel) renders the full document;
 * compact surfaces show an icon so listing many attachments stays cheap.
 */
export const OfficeDocumentPreview: React.FC<OfficeDocumentPreviewProps> = ({
  fileURL,
  name,
  kind,
  size = "small",
  sizeBytes,
}) => {
  const t = useTranslations("attachments.preview");
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [slideCount, setSlideCount] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Holds the pptxviewjs PPTXViewer instance so slide-nav handlers and cleanup
  // can reach it. Typed loosely to avoid importing the class type eagerly.
  const viewerRef = useRef<{
    getSlideCount: () => number;
    getCurrentSlideIndex: () => number;
    goToSlide: (i: number) => Promise<unknown>;
    destroy: () => void;
  } | null>(null);

  const isLarge = size === "large";

  useEffect(() => {
    if (!isLarge) return;
    if (sizeBytes != null && Number(sizeBytes) > MAX_PREVIEW_BYTES) {
      setStatus("tooLarge");
      return;
    }

    let active = true;
    const controller = new AbortController();
    // Capture the mounted nodes now so the cleanup below references stable
    // values rather than reading refs that may have moved on.
    const containerNode = containerRef.current;
    const canvasNode = canvasRef.current;
    setStatus("loading");

    const disposeViewer = () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {
          // ignore teardown errors
        }
        viewerRef.current = null;
      }
    };

    void (async () => {
      try {
        const response = await fetch(fileURL, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to fetch attachment (${response.status})`);
        }

        if (kind === "word") {
          // Pass an ArrayBuffer (not a Blob): docx-preview forwards the input to
          // JSZip, which reads a Blob via FileReader.readAsArrayBuffer — a path
          // that can intermittently fail. An ArrayBuffer is processed directly.
          const buffer = await response.arrayBuffer();
          if (!active) return;
          const { renderAsync } = await import("docx-preview");
          const container = containerNode;
          if (!active || !container) return;
          container.innerHTML = "";
          await renderAsync(buffer, container, undefined, {
            className: "docx",
            inWrapper: true,
            ignoreLastRenderedPageBreak: true,
          });
          if (!active) return;
          // Neutralize javascript: links and force external links to open safely.
          container.querySelectorAll("a").forEach((anchor) => {
            const href = anchor.getAttribute("href")?.trim() ?? "";
            if (href.toLowerCase().startsWith("javascript:")) {
              anchor.removeAttribute("href");
            } else if (href) {
              anchor.setAttribute("target", "_blank");
              anchor.setAttribute("rel", "noopener noreferrer");
            }
          });
          setStatus("ready");
        } else if (kind === "excel") {
          const buffer = await response.arrayBuffer();
          if (!active) return;
          const XLSX = await import("xlsx");
          // SheetJS `type: "array"` expects a byte array (Uint8Array); a raw
          // ArrayBuffer mis-parses and leaves the sheet without a `!ref` range.
          const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const sheet = firstSheetName
            ? workbook.Sheets[firstSheetName]
            : undefined;
          // sheet_to_html reads the sheet's `!ref` range; guard empty sheets so
          // it doesn't throw on an undefined range.
          const rawHtml =
            sheet && sheet["!ref"] ? XLSX.utils.sheet_to_html(sheet) : "";
          if (!active) return;
          if (!rawHtml) {
            setStatus("empty");
            return;
          }
          const DOMPurify = (await import("dompurify")).default;
          const container = containerNode;
          if (!active || !container) return;
          // sheet_to_html returns a raw HTML string: sanitize before injecting.
          container.innerHTML = DOMPurify.sanitize(rawHtml);
          setStatus("ready");
        } else {
          const buffer = await response.arrayBuffer();
          if (!active) return;
          const { PPTXViewer } = await import("pptxviewjs");
          const canvas = canvasNode;
          if (!active || !canvas) return;
          const viewer = new PPTXViewer({
            canvas,
            slideSizeMode: "fit",
            backgroundColor: "#ffffff",
          });
          viewerRef.current = viewer;
          await viewer.loadFile(buffer);
          if (!active) return disposeViewer();
          await viewer.render();
          if (!active) return disposeViewer();
          setSlideCount(viewer.getSlideCount());
          setSlideIndex(viewer.getCurrentSlideIndex());
          setStatus("ready");
        }
      } catch (error) {
        const aborted =
          error instanceof DOMException && error.name === "AbortError";
        if (active && !aborted) {
          setStatus("error");
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
      disposeViewer();
      if (containerNode) containerNode.innerHTML = "";
    };
  }, [fileURL, kind, isLarge, sizeBytes]);

  const goToSlide = useCallback(async (target: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const clamped = Math.max(0, Math.min(target, viewer.getSlideCount() - 1));
    await viewer.goToSlide(clamped);
    setSlideIndex(viewer.getCurrentSlideIndex());
  }, []);

  const iconFallback = (message?: string) => (
    <div className="flex flex-col items-center gap-2 overflow-hidden max-h-fit p-3">
      <File className="w-16 h-16 text-primary" />
      <span className="text-center truncate max-w-full">{name}</span>
      {message ? (
        <span className="text-sm text-muted-foreground text-center">
          {message}
        </span>
      ) : null}
      {message ? (
        <a
          href={fileURL}
          download={name}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 text-sm text-primary underline hover:opacity-80"
        >
          <Download className="w-4 h-4" />
          {t("download")}
        </a>
      ) : null}
    </div>
  );

  // Compact surfaces (list badges) never parse the document.
  if (!isLarge) return iconFallback();

  if (status === "tooLarge") return iconFallback(t("tooLarge"));
  if (status === "error") return iconFallback(t("unavailable"));
  if (status === "empty") return iconFallback(t("empty"));

  return (
    <div className={cn(styles.wrapper, "bg-muted")}>
      {status === "loading" ? (
        <div className={styles.loadingOverlay}>
          <LoadingSpinner delay={0} />
        </div>
      ) : null}

      {kind === "powerpoint" ? (
        <div className={styles.pptxStage}>
          <canvas ref={canvasRef} className={styles.canvas} />
          {status === "ready" && slideCount > 1 ? (
            <div className="flex items-center gap-3 text-sm text-foreground">
              <button
                type="button"
                onClick={() => goToSlide(slideIndex - 1)}
                disabled={slideIndex <= 0}
                aria-label={t("previousSlide")}
                className="rounded-md p-1 hover:bg-background disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span>
                {t("slideCounter", {
                  current: String(slideIndex + 1),
                  total: String(slideCount),
                })}
              </span>
              <button
                type="button"
                onClick={() => goToSlide(slideIndex + 1)}
                disabled={slideIndex >= slideCount - 1}
                aria-label={t("nextSlide")}
                className="rounded-md p-1 hover:bg-background disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          ref={containerRef}
          className={cn(styles.docContainer, kind === "excel" && styles.excel)}
        />
      )}
    </div>
  );
};

export default OfficeDocumentPreview;
