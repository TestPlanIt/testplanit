import { LinkEditorPanel } from "@/components/tiptap/panels";
import { Icon } from "@/components/tiptap/ui/Icon";
import { Toolbar } from "@/components/tiptap/ui/Toolbar";
import * as Popover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";

export type EditLinkPopoverProps = {
  onSetLink: (link: string, openInNewTab?: boolean) => void;
};

export const EditLinkPopover = ({ onSetLink }: EditLinkPopoverProps) => {
  const t = useTranslations("common.editor.textMenu");
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Toolbar.Button tooltip={t("setLink")}>
          <Icon name="Link" />
        </Toolbar.Button>
      </Popover.Trigger>
      <Popover.Content>
        <LinkEditorPanel onSetLink={onSetLink} />
      </Popover.Content>
    </Popover.Root>
  );
};
