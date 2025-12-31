import { Icon } from "@/components/tiptap/ui/Icon";
import { Toolbar } from "@/components/tiptap/ui/Toolbar";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { Editor } from "@tiptap/react";

import * as Popover from "@radix-ui/react-popover";
import { Surface } from "@/components/tiptap/ui/Surface";
import { DropdownButton } from "@/components/tiptap/ui/Dropdown";
import useContentItemActions from "./hooks/useContentItemActions";
import { useData } from "./hooks/useData";
import { useEffect, useState } from "react";

export type ContentItemMenuProps = {
  editor: Editor;
  editable: boolean;
};

export const ContentItemMenu = ({ editor, editable }: ContentItemMenuProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const data = useData();
  const actions = useContentItemActions(
    editor,
    data.currentNode,
    data.currentNodePos
  );

  useEffect(() => {
    if (!editor?.commands) return;
    try {
      if (menuOpen) {
        editor.commands.setMeta("lockDragHandle", true);
      } else {
        editor.commands.setMeta("lockDragHandle", false);
      }
    } catch (error) {
      // Silently handle invalid content errors - the editor may have been
      // initialized with malformed content that doesn't match the schema
      console.warn("ContentItemMenu: Error setting meta on editor", error);
    }
  }, [editor, menuOpen]);

  // Don't render DragHandle if editor doesn't support plugins (e.g., in tests)
  if (!editor?.registerPlugin) {
    return null;
  }

  return (
    <DragHandle
      pluginKey="ContentItemMenu"
      editor={editor}
      onNodeChange={data.handleNodeChange}
    >
      <div className={`flex items-center gap-0.5 ${!editable ? "hidden" : ""}`}>
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <Toolbar.Button
              className="cursor-grab active:cursor-grabbing p-0 min-w-0!"
              data-drag-handle
            >
              <Icon name="GripVertical" />
            </Toolbar.Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="start"
              sideOffset={8}
              avoidCollisions
              collisionPadding={10}
              className="radix-side-bottom:animate-slide-down radix-side-top:animate-slide-up"
              style={{ pointerEvents: "auto", zIndex: 9999 }}
            >
              <Surface className="p-2 flex flex-col min-w-[16rem]">
                <Popover.Close>
                  <DropdownButton onClick={actions.handleAdd}>
                    <Icon name="Plus" />
                    Add paragraph below
                  </DropdownButton>
                </Popover.Close>
                <Popover.Close>
                  <DropdownButton onClick={actions.resetTextFormatting}>
                    <Icon name="RemoveFormatting" />
                    Clear formatting
                  </DropdownButton>
                </Popover.Close>
                <Popover.Close>
                  <DropdownButton onClick={actions.copyNodeToClipboard}>
                    <Icon name="Clipboard" />
                    Copy to clipboard
                  </DropdownButton>
                </Popover.Close>
                <Popover.Close>
                  <DropdownButton onClick={actions.duplicateNode}>
                    <Icon name="Copy" />
                    Duplicate
                  </DropdownButton>
                </Popover.Close>
                <Toolbar.Divider horizontal />
                <Popover.Close>
                  <DropdownButton
                    onClick={actions.deleteNode}
                    className="text-destructive bg-destructive hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <Icon name="Trash2" />
                    Delete
                  </DropdownButton>
                </Popover.Close>
              </Surface>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </DragHandle>
  );
};
