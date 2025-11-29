import { BubbleMenu } from "@tiptap/react/menus";
import React, { useCallback } from "react";
import * as PopoverMenu from "@/components/tiptap/ui/PopoverMenu";

import { Toolbar } from "@/components/tiptap/ui/Toolbar";
import { isRowGripSelected } from "./utils";
import { Icon } from "@/components/tiptap/ui/Icon";
import { MenuProps, ShouldShowProps } from "@/components/tiptap/menus/types";

export const TableRowMenu = React.memo(
  ({ editor, appendTo }: MenuProps): React.ReactElement => {
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
        editor={editor}
        pluginKey="tableRowMenu"
        updateDelay={0}
        options={{
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
            label="Add row before"
            onClick={onAddRowBefore}
          />
          <PopoverMenu.Item
            iconComponent={<Icon name="ArrowDownToLine" />}
            close={false}
            label="Add row after"
            onClick={onAddRowAfter}
          />
          <PopoverMenu.Item
            icon="Trash"
            close={false}
            label="Delete row"
            onClick={onDeleteRow}
          />
        </Toolbar.Wrapper>
      </BubbleMenu>
    );
  }
);

TableRowMenu.displayName = "TableRowMenu";

export default TableRowMenu;
