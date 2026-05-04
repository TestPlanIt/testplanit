import { ColorPicker } from "@/components/tiptap/panels";
import { Icon } from "@/components/tiptap/ui/Icon";
import { Surface } from "@/components/tiptap/ui/Surface";
import { Toolbar } from "@/components/tiptap/ui/Toolbar";
import * as Popover from "@radix-ui/react-popover";
import { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { ContentTypePicker } from "./components/ContentTypePicker";
import { EditLinkPopover } from "./components/EditLinkPopover";
import { FontFamilyPicker } from "./components/FontFamilyPicker";
import { FontSizePicker } from "./components/FontSizePicker";
import { useTextmenuCommands } from "./hooks/useTextmenuCommands";
import { useTextmenuContentTypes } from "./hooks/useTextmenuContentTypes";
import { useTextmenuStates } from "./hooks/useTextmenuStates";

// We memorize the button so each button is not rerendered
// on every editor state change
const MemoButton = memo(Toolbar.Button);
const MemoColorPicker = memo(ColorPicker);
const MemoFontFamilyPicker = memo(FontFamilyPicker);
const MemoFontSizePicker = memo(FontSizePicker);
const MemoContentTypePicker = memo(ContentTypePicker);

export type TextMenuProps = {
  editor: Editor;
};

export const TextMenu = ({ editor }: TextMenuProps) => {
  const commands = useTextmenuCommands(editor);
  const states = useTextmenuStates(editor);
  const blockOptions = useTextmenuContentTypes(editor);
  const t = useTranslations("common.editor.textMenu");

  return (
    <BubbleMenu
      options={{ placement: "top-start" }}
      editor={editor}
      pluginKey="textMenu"
      shouldShow={states.shouldShow}
      updateDelay={100}
    >
      <Toolbar.Wrapper>
        <MemoContentTypePicker options={blockOptions} />
        <MemoFontFamilyPicker
          onChange={commands.onSetFont}
          value={states.currentFont || ""}
        />
        <MemoFontSizePicker
          onChange={commands.onSetFontSize}
          value={states.currentSize || ""}
        />
        <Toolbar.Divider />
        <MemoButton
          tooltip={t("bold")}
          tooltipShortcut={["Mod", "B"]}
          onClick={commands.onBold}
          active={states.isBold}
        >
          <Icon name="Bold" />
        </MemoButton>
        <MemoButton
          tooltip={t("italic")}
          tooltipShortcut={["Mod", "I"]}
          onClick={commands.onItalic}
          active={states.isItalic}
        >
          <Icon name="Italic" />
        </MemoButton>
        <MemoButton
          tooltip={t("underline")}
          tooltipShortcut={["Mod", "U"]}
          onClick={commands.onUnderline}
          active={states.isUnderline}
        >
          <Icon name="Underline" />
        </MemoButton>
        <MemoButton
          tooltip={t("strikethrough")}
          tooltipShortcut={["Mod", "Shift", "S"]}
          onClick={commands.onStrike}
          active={states.isStrike}
        >
          <Icon name="Strikethrough" />
        </MemoButton>
        <MemoButton
          tooltip={t("code")}
          tooltipShortcut={["Mod", "E"]}
          onClick={commands.onCode}
          active={states.isCode}
        >
          <Icon name="Code" />
        </MemoButton>
        <MemoButton tooltip={t("codeBlock")} onClick={commands.onCodeBlock}>
          <Icon name="Code" />
        </MemoButton>
        <EditLinkPopover onSetLink={commands.onLink} />
        <Popover.Root>
          <Popover.Trigger asChild>
            <MemoButton
              active={!!states.currentHighlight}
              tooltip={t("highlightText")}
            >
              <Icon name="Highlighter" />
            </MemoButton>
          </Popover.Trigger>
          <Popover.Content
            className="z-50"
            side="bottom"
            sideOffset={8}
            asChild
          >
            <Surface className="p-1">
              <MemoColorPicker
                color={states.currentHighlight}
                onChange={commands.onChangeHighlight}
                onClear={commands.onClearHighlight}
              />
            </Surface>
          </Popover.Content>
        </Popover.Root>
        <Popover.Root>
          <Popover.Trigger asChild>
            <MemoButton active={!!states.currentColor} tooltip={t("textColor")}>
              <Icon name="Palette" />
            </MemoButton>
          </Popover.Trigger>
          <Popover.Content
            className="z-50"
            side="bottom"
            sideOffset={8}
            asChild
          >
            <Surface className="p-1">
              <MemoColorPicker
                color={states.currentColor}
                onChange={commands.onChangeColor}
                onClear={commands.onClearColor}
              />
            </Surface>
          </Popover.Content>
        </Popover.Root>
        <Popover.Root>
          <Popover.Trigger asChild>
            <MemoButton tooltip={t("moreOptions")}>
              <Icon name="EllipsisVertical" />
            </MemoButton>
          </Popover.Trigger>
          <Popover.Content side="top" asChild>
            <Toolbar.Wrapper>
              <MemoButton
                tooltip={t("subscript")}
                tooltipShortcut={["Mod", "."]}
                onClick={commands.onSubscript}
                active={states.isSubscript}
              >
                <Icon name="Subscript" />
              </MemoButton>
              <MemoButton
                tooltip={t("superscript")}
                tooltipShortcut={["Mod", ","]}
                onClick={commands.onSuperscript}
                active={states.isSuperscript}
              >
                <Icon name="Superscript" />
              </MemoButton>
              <Toolbar.Divider />
              <MemoButton
                tooltip={t("alignLeft")}
                tooltipShortcut={["Shift", "Mod", "L"]}
                onClick={commands.onAlignLeft}
                active={states.isAlignLeft}
              >
                <Icon name="TextAlignStart" />
              </MemoButton>
              <MemoButton
                tooltip={t("alignCenter")}
                tooltipShortcut={["Shift", "Mod", "E"]}
                onClick={commands.onAlignCenter}
                active={states.isAlignCenter}
              >
                <Icon name="TextAlignCenter" />
              </MemoButton>
              <MemoButton
                tooltip={t("alignRight")}
                tooltipShortcut={["Shift", "Mod", "R"]}
                onClick={commands.onAlignRight}
                active={states.isAlignRight}
              >
                <Icon name="TextAlignEnd" />
              </MemoButton>
              <MemoButton
                tooltip={t("justify")}
                tooltipShortcut={["Shift", "Mod", "J"]}
                onClick={commands.onAlignJustify}
                active={states.isAlignJustify}
              >
                <Icon name="TextAlignJustify" />
              </MemoButton>
            </Toolbar.Wrapper>
          </Popover.Content>
        </Popover.Root>
      </Toolbar.Wrapper>
    </BubbleMenu>
  );
};
