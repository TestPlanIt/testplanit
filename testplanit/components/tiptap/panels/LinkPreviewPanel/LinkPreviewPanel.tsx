import { Icon } from "@/components/tiptap/ui/Icon";
import { Surface } from "@/components/tiptap/ui/Surface";
import { Toolbar } from "@/components/tiptap/ui/Toolbar";
import Tooltip from "@/components/tiptap/ui/Tooltip";
import { useTranslations } from "next-intl";

export type LinkPreviewPanelProps = {
  url: string;
  onEdit: () => void;
  onClear: () => void;
};

export const LinkPreviewPanel = ({
  onClear,
  onEdit,
  url,
}: LinkPreviewPanelProps) => {
  const t = useTranslations("common.editor.textMenu");
  return (
    <Surface className="flex items-center gap-2 p-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm underline break-all"
      >
        {url}
      </a>
      <Toolbar.Divider />
      <Tooltip title={t("editLink")}>
        <Toolbar.Button onClick={onEdit}>
          <Icon name="Pen" />
        </Toolbar.Button>
      </Tooltip>
      <Tooltip title={t("removeLink")}>
        <Toolbar.Button onClick={onClear}>
          <Icon name="Trash2" />
        </Toolbar.Button>
      </Tooltip>
    </Surface>
  );
};
