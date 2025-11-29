import { cn } from "~/utils";
import { Node } from "@tiptap/pm/model";
import { Editor, NodeViewWrapper, ReactNodeViewProps } from "@tiptap/react";
import { useCallback, useRef } from "react";

type ImageBlockAttributes = {
  src: string;
  width?: string;
  align?: "left" | "center" | "right";
};

export const ImageBlockView = (props: ReactNodeViewProps<HTMLElement>) => {
  const { editor, getPos, node } = props;
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const attrs = node.attrs as ImageBlockAttributes;
  const { src } = attrs;

  const wrapperClassName = cn(
    attrs.align === "left" ? "ml-0" : "ml-auto",
    attrs.align === "right" ? "mr-0" : "mr-auto",
    attrs.align === "center" && "mx-auto"
  );

  const onClick = useCallback(() => {
    const pos = getPos();
    if (pos !== undefined) {
      editor.commands.setNodeSelection(pos);
    }
  }, [getPos, editor.commands]);

  return (
    <NodeViewWrapper>
      <div className={wrapperClassName} style={{ width: attrs.width }}>
        <div contentEditable={false} ref={imageWrapperRef}>
          <picture>
            <img className="block" src={src} alt="" onClick={onClick} />
          </picture>
        </div>
      </div>
    </NodeViewWrapper>
  );
};
