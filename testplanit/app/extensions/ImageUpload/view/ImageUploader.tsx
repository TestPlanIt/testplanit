import { Button } from "@/components/tiptap/ui/Button";
import { Icon } from "@/components/tiptap/ui/Icon";
import { Spinner } from "@/components/tiptap/ui/Spinner";
import { ChangeEvent, useCallback } from "react";
import { cn } from "~/utils";
import { useDropZone, useFileUpload } from "./hooks";

export const ImageUploader = ({
  onUpload,
  loading,
}: {
  onUpload: (file: File) => void;
  loading: boolean;
}) => {
  const { handleUploadClick, ref } = useFileUpload();
  const { draggedInside, onDrop, onDragEnter, onDragLeave } = useDropZone({
    uploader: onUpload,
  });

  const onFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        onUpload(e.target.files[0]);
      }
    },
    [onUpload]
  );

  if (loading) {
    return (
      <div className="bg-opacity-80 flex min-h-[10rem] items-center justify-center rounded-lg p-8">
        <Spinner className="text-neutral-500" size={1.5} />
      </div>
    );
  }

  const wrapperClass = cn(
    "bg-opacity-80 flex flex-col items-center justify-center rounded-lg px-8 py-10",
    draggedInside && "bg-neutral-100"
  );

  return (
    <div
      className={wrapperClass}
      onDrop={onDrop}
      onDragOver={onDragEnter}
      onDragLeave={onDragLeave}
      contentEditable={false}
    >
      <Icon
        name="Image"
        className="mb-4 h-12 w-12 text-black opacity-20 dark:text-white"
      />
      <div className="flex flex-col items-center justify-center gap-2">
        <div className="text-center text-sm font-medium text-neutral-600 dark:text-neutral-400">
          {draggedInside ? "Drop image here" : "Drag and drop or"}
        </div>
        <div>
          <Button
            disabled={draggedInside}
            onClick={handleUploadClick}
            variant="primary"
            buttonSize="small"
          >
            <Icon name="Upload" />
            Upload an image
          </Button>
        </div>
      </div>
      <input
        className="h-0 w-0 overflow-hidden opacity-0"
        ref={ref}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif"
        onChange={onFileChange}
      />
    </div>
  );
};

export default ImageUploader;
