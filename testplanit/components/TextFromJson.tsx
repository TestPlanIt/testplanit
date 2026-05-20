import TipTapEditor from "@/components/tiptap/TipTapEditor";
import React, { useEffect, useState } from "react";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

interface TextFromJsonProps {
  jsonString: string | object;
  format?: "text" | "html";
  room: string;
  parameters?: ParameterChipMeta[];
}

const TextFromJson: React.FC<TextFromJsonProps> = ({
  jsonString: jsonStringProp,
  format = "text",
  room,
  parameters,
}) => {
  const jsonString =
    typeof jsonStringProp === "string"
      ? jsonStringProp
      : JSON.stringify(jsonStringProp);
  const [plainText, setPlainText] = useState("");

  useEffect(() => {
    if (format !== "text") return;
    try {
      const jsonContent = JSON.parse(jsonString);
      setPlainText(extractTextFromNode(jsonContent));
    } catch {
      setPlainText(jsonString);
    }
  }, [jsonString, format]);

  if (format === "text") {
    return <span>{plainText}</span>;
  }

  return (
    <TipTapEditorWrapper
      jsonString={jsonString}
      room={room}
      parameters={parameters}
    />
  );
};

const isValidTipTapContent = (content: any): boolean => {
  // Check if it's a valid TipTap document structure
  if (!content || typeof content !== "object") return false;
  if (content.type !== "doc") return false;
  if (!Array.isArray(content.content)) return false;

  // Basic validation of content nodes
  for (const node of content.content) {
    if (!node || typeof node !== "object" || !node.type) {
      return false;
    }
  }

  return true;
};

const TipTapEditorWrapper: React.FC<{
  jsonString: string | object;
  room: string;
  parameters?: ParameterChipMeta[];
}> = ({ jsonString: jsonStringProp, room, parameters }) => {
  const jsonString =
    typeof jsonStringProp === "string"
      ? jsonStringProp
      : JSON.stringify(jsonStringProp);
  let content;

  try {
    content = JSON.parse(jsonString);
  } catch {
    return <span>{jsonString}</span>;
  }

  // Validate that the parsed content is a valid TipTap document
  if (!isValidTipTapContent(content)) {
    // If it's not valid TipTap content, render as plain text or HTML
    if (typeof jsonString === "string" && jsonString.includes("<")) {
      return (
        <div
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: jsonString }}
        />
      );
    }
    return <span>{jsonString}</span>;
  }

  return (
    <div className="compact-prose">
      <TipTapEditor
        key={room}
        content={content}
        readOnly={true}
        className="w-full"
        parameters={parameters}
      />
    </div>
  );
};

export default TextFromJson;
