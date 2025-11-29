import { BubbleMenu } from "@tiptap/react/menus";
import React, { useCallback } from "react";
import * as PopoverMenu from "@/components/tiptap/ui/PopoverMenu";

import { Toolbar } from "@/components/tiptap/ui/Toolbar";
import { isColumnGripSelected } from "./utils";
import { Icon } from "@/components/tiptap/ui/Icon";
import { MenuProps, ShouldShowProps } from "@/components/tiptap/menus/types";

export const TableColumnMenu = React.memo(
  ({ editor, appendTo }: MenuProps): React.ReactElement => {
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
        editor={editor}
        pluginKey="tableColumnMenu"
        updateDelay={0}
        options={{
          offset: { mainAxis: 15 },
          flip: false,
        }}
        shouldShow={shouldShow}
      >
        <Toolbar.Wrapper isVertical>
          <PopoverMenu.Item
            iconComponent={<Icon name="ArrowLeftToLine" />}
            close={false}
            label="Add column before"
            onClick={onAddColumnBefore}
          />
          <PopoverMenu.Item
            iconComponent={<Icon name="ArrowRightToLine" />}
            close={false}
            label="Add column after"
            onClick={onAddColumnAfter}
          />
          <PopoverMenu.Item
            icon="Trash"
            close={false}
            label="Delete column"
            onClick={onDeleteColumn}
          />
        </Toolbar.Wrapper>
      </BubbleMenu>
    );
  }
);

TableColumnMenu.displayName = "TableColumnMenu";

export default TableColumnMenu;
