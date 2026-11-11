import { Folder } from "lucide-react";

export const CustomDragPreview = (props: any) => {
  const item = props.monitorProps.item;

  return (
    <div className="flex w-fit items-center space-x-2 rounded bg-accent p-2 opacity-80">
      <div className="drag-handle cursor-move" data-testid={`drag-preview`}>
        <Folder className="h-4 w-4" />
      </div>
      <div>
        <p className="-ms-1 font-medium whitespace-nowrap">{item.text}</p>
      </div>
    </div>
  );
};
