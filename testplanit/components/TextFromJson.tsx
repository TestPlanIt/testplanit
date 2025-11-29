import React, { useState, useRef, useEffect } from "react";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { ChevronDownCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

interface TextFromJsonProps {
  jsonString: string;
  format?: "text" | "html";
  room: string;
  expand?: boolean;
  expandable?: boolean;
}

const TextFromJson: React.FC<TextFromJsonProps> = ({
  jsonString,
  format = "text",
  room,
  expand = false,
  expandable = true,
}) => {
  const [plainText, setPlainText] = useState("");
  const [isOpen, setIsOpen] = useState(expand);
  const [showButton, setShowButton] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (format === "text") {
        const jsonContent = JSON.parse(jsonString);
        const text = extractTextFromNode(jsonContent);
        setPlainText(text);
      } else {
        setPlainText(jsonString);
      }
    } catch (error) {
      setPlainText(jsonString);
    }
  }, [jsonString, format]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (contentRef.current) {
        const contentHeight = contentRef.current.scrollHeight;
        const containerHeight = 75;
        setShowButton(expandable && contentHeight > containerHeight);
      }
    });

    if (contentRef.current) {
      observer.observe(contentRef.current, { childList: true, subtree: true });
    }

    return () => {
      observer.disconnect();
    };
  }, [plainText, expandable]);

  useEffect(() => {
    setIsOpen(expand);
  }, [expand]);

  return format === "text" ? (
    <span>{plainText}</span>
  ) : (
    <div>
      <div className="flex items-start">
        <div
          ref={contentRef}
          className={`overflow-hidden transition-max-height duration-500 ease-in-out ${
            isOpen ? "" : "max-h-[75px]"
          }`}
        >
          <TipTapEditorWrapper jsonString={jsonString} room={room} />
        </div>
      </div>
      {showButton && (
        <div className="flex whitespace-nowrap items-center mt-2">
          <div className="border-t-2 border-double border-primary w-1/2" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsOpen(!isOpen)}
          >
            <ChevronDownCircle
              className={`text-primary/50 h-5 w-5 shrink-0 transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
          <div className="border-t-2 border-double border-primary w-1/2" />
        </div>
      )}
    </div>
  );
};

const TipTapEditorWrapper: React.FC<{
  jsonString: string;
  room: string;
}> = ({ jsonString, room }) => {
  let content;

  try {
    content = JSON.parse(jsonString);
  } catch (error) {
    return <span>{jsonString}</span>;
  }

  return (
    <div className="compact-prose">
      <TipTapEditor
        key={room}
        content={content}
        readOnly={true}
        className="w-full"
      />
    </div>
  );
};

export default TextFromJson;
