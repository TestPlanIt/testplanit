import { Folder } from "lucide-react";

export const CustomDragPreview = (props: any) => {
  const item = props.monitorProps.item;

  return (
    <div className="flex items-center space-x-2 w-fit bg-accent rounded p-2 opacity-80">
      <div className="drag-handle cursor-move" data-testid={`drag-preview`}>
        <Folder className="w-4 h-4" />
      </div>
      <div>
        <p className="whitespace-nowrap -ml-1 font-medium">{item.text}</p>
      </div>
    </div>
  );
};
