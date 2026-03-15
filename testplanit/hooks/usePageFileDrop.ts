"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface UsePageFileDropOptions {
  /** File extensions to accept (e.g., ['.csv', '.xml']) */
  acceptedExtensions: string[];
  /** Whether drop is enabled (e.g., based on permissions) */
  enabled: boolean;
  /** Callback when valid files are dropped */
  onDrop: (files: File[]) => void;
  /** Error message for unsupported file types */
  unsupportedMessage?: string;
}

interface UsePageFileDropReturn {
  /** Whether a file is currently being dragged over the page */
  isDragActive: boolean;
}

function hasFileType(event: DragEvent): boolean {
  return event.dataTransfer?.types?.includes("Files") ?? false;
}

function validateFiles(
  files: File[],
  acceptedExtensions: string[]
): { valid: File[]; invalid: File[] } {
  const valid: File[] = [];
  const invalid: File[] = [];

  for (const file of files) {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (acceptedExtensions.some((a) => a.toLowerCase() === ext)) {
      valid.push(file);
    } else {
      invalid.push(file);
    }
  }

  return { valid, invalid };
}

export function usePageFileDrop({
  acceptedExtensions,
  enabled,
  onDrop,
  unsupportedMessage,
}: UsePageFileDropOptions): UsePageFileDropReturn {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragCounterRef = useRef(0);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const acceptedRef = useRef(acceptedExtensions);
  useEffect(() => {
    acceptedRef.current = acceptedExtensions;
  }, [acceptedExtensions]);

  const unsupportedMsgRef = useRef(unsupportedMessage);
  useEffect(() => {
    unsupportedMsgRef.current = unsupportedMessage;
  }, [unsupportedMessage]);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      if (!enabled || !hasFileType(e)) return;
      e.preventDefault();
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsDragActive(true);
      }
    },
    [enabled]
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragActive(false);
      }
    },
    [enabled]
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!enabled || !hasFileType(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    },
    [enabled]
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (!enabled) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragActive(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      const { valid, invalid } = validateFiles(files, acceptedRef.current);

      if (valid.length > 0) {
        onDropRef.current(valid);
      }

      if (invalid.length > 0 && valid.length === 0) {
        const msg =
          unsupportedMsgRef.current ??
          `Unsupported file type. Expected: ${acceptedRef.current.join(", ")}`;
        toast.error(msg);
      }
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) {
      setIsDragActive(false);
      dragCounterRef.current = 0;
      return;
    }

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
      dragCounterRef.current = 0;
    };
  }, [enabled, handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return { isDragActive };
}
