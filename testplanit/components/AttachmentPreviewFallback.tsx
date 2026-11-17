import { Download, File } from "lucide-react";
import { useTranslations } from "next-intl";

interface AttachmentPreviewFallbackProps {
  name: string;
  fileURL: string;
  /** Why there is no preview. Without one, only the icon and name show. */
  message?: string;
}

/** What an attachment shows when its content cannot be previewed. */
export const AttachmentPreviewFallback: React.FC<
  AttachmentPreviewFallbackProps
> = ({ name, fileURL, message }) => {
  const t = useTranslations("attachments.preview");
  return (
    <div className="flex max-h-fit flex-col items-center gap-2 overflow-hidden p-3">
      <File className="h-16 w-16 text-primary" />
      <span className="max-w-full truncate text-center">{name}</span>
      {message ? (
        <span className="text-center text-sm text-muted-foreground">
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
          <Download className="h-4 w-4" />
          {t("download")}
        </a>
      ) : null}
    </div>
  );
};
