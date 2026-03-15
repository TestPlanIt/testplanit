import * as PopoverMenu from "@/components/tiptap/ui/PopoverMenu";
import { BubbleMenu } from "@tiptap/react/menus";
import { useTranslations } from "next-intl";
import React, { useCallback } from "react";

import { MenuProps, ShouldShowProps } from "@/components/tiptap/menus/types";
import { Icon } from "@/components/tiptap/ui/Icon";
import { Toolbar } from "@/components/tiptap/ui/Toolbar";
import { isRowGripSelected } from "./utils";

export const TableRowMenu = React.memo(
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
        if (!state || !from) {
          return false;
        }

        return isRowGripSelected({ editor, view, state, from });
      },
      [editor]
    );

    const onAddRowBefore = useCallback(() => {
      editor.chain().focus().addRowBefore().run();
    }, [editor]);

    const onAddRowAfter = useCallback(() => {
      editor.chain().focus().addRowAfter().run();
    }, [editor]);

    const onDeleteRow = useCallback(() => {
      editor.chain().focus().deleteRow().run();
    }, [editor]);

    return (
      <BubbleMenu
        ref={menuRef}
        editor={editor}
        pluginKey="tableRowMenu"
        updateDelay={0}
        appendTo={appendTo?.current || document.body}
        options={{
          strategy: "fixed",
          placement: "left",
          offset: { mainAxis: 15 },
          flip: false,
        }}
        shouldShow={shouldShow}
      >
        <Toolbar.Wrapper isVertical>
          <PopoverMenu.Item
            iconComponent={<Icon name="ArrowUpToLine" />}
            close={false}
            label={t("addRowBefore")}
            onClick={onAddRowBefore}
          />
          <PopoverMenu.Item
            iconComponent={<Icon name="ArrowDownToLine" />}
            close={false}
            label={t("addRowAfter")}
            onClick={onAddRowAfter}
          />
          <PopoverMenu.Item
            icon="Trash"
            close={false}
            label={t("deleteRow")}
            onClick={onDeleteRow}
            className="text-destructive! hover:bg-destructive! hover:text-destructive-foreground!"
          />
        </Toolbar.Wrapper>
      </BubbleMenu>
    );
  }
);

TableRowMenu.displayName = "TableRowMenu";

export default TableRowMenu;
