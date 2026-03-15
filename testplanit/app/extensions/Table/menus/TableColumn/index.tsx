import * as PopoverMenu from "@/components/tiptap/ui/PopoverMenu";
import { BubbleMenu } from "@tiptap/react/menus";
import { useTranslations } from "next-intl";
import React, { useCallback } from "react";

import { MenuProps, ShouldShowProps } from "@/components/tiptap/menus/types";
import { Icon } from "@/components/tiptap/ui/Icon";
import { Toolbar } from "@/components/tiptap/ui/Toolbar";
import { isColumnGripSelected } from "./utils";

export const TableColumnMenu = React.memo(
  ({ editor, appendTo }: MenuProps): React.ReactElement | null => {
    // Don't render BubbleMenu if editor doesn't support plugins (e.g., in tests)
    if (!editor?.registerPlugin) {
      return null;
    }
    const t = useTranslations("common.editor.table");
    const menuRef = useCallback((el: HTMLDivElement | null) => {
      if (el) {
        el.style.zIndex = "9999";
      }
    }, []);

    const shouldShow = useCallback(
      ({ view, state, from }: ShouldShowProps) => {
        if (!state) {
          return false;
        }

        return isColumnGripSelected({ editor, view, state, from: from || 0 });
      },
      [editor]
    );

    const onAddColumnBefore = useCallback(() => {
      editor.chain().focus().addColumnBefore().run();
    }, [editor]);

    const onAddColumnAfter = useCallback(() => {
      editor.chain().focus().addColumnAfter().run();
    }, [editor]);

    const onDeleteColumn = useCallback(() => {
      editor.chain().focus().deleteColumn().run();
    }, [editor]);

    return (
      <BubbleMenu
        ref={menuRef}
        editor={editor}
        pluginKey="tableColumnMenu"
        updateDelay={0}
        appendTo={appendTo?.current || document.body}
        options={{
          strategy: "fixed",
          offset: { mainAxis: 15 },
          flip: false,
        }}
        shouldShow={shouldShow}
      >
        <Toolbar.Wrapper isVertical>
          <PopoverMenu.Item
            iconComponent={<Icon name="ArrowLeftToLine" />}
            close={false}
            label={t("addColumnBefore")}
            onClick={onAddColumnBefore}
          />
          <PopoverMenu.Item
            iconComponent={<Icon name="ArrowRightToLine" />}
            close={false}
            label={t("addColumnAfter")}
            onClick={onAddColumnAfter}
          />
          <PopoverMenu.Item
            icon="Trash"
            close={false}
            label={t("deleteColumn")}
            onClick={onDeleteColumn}
            className="text-destructive! hover:bg-destructive! hover:text-destructive-foreground!"
          />
        </Toolbar.Wrapper>
      </BubbleMenu>
    );
  }
);

TableColumnMenu.displayName = "TableColumnMenu";

export default TableColumnMenu;
