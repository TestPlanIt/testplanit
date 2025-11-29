import { Editor, NodeViewWrapper } from "@tiptap/react";
import { useCallback } from "react";

import { ImageUploader } from "./ImageUploader";
import { useUploader } from "./hooks";

export const ImageUpload = ({
  getPos,
  editor,
}: {
  getPos: () => number | undefined;
  editor: Editor;
}) => {
  const onUpload = useCallback(
    (url: string) => {
      if (url) {
        const pos = getPos();
        if (pos !== undefined) {
          editor
            .chain()
            .setImageBlock({ src: url })
            .deleteRange({ from: pos, to: pos })
            .focus()
            .run();
        }
      }
    },
    [getPos, editor]
  );

  const { loading, uploadFile } = useUploader({ onUpload });

  return (
    <NodeViewWrapper>
      <div className="p-0 m-0" data-drag-handle>
        <ImageUploader onUpload={uploadFile} loading={loading} />
      </div>
    </NodeViewWrapper>
  );
};

export default ImageUpload;
