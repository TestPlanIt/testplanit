"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { JSONContent } from "@tiptap/core";
import { Button } from "~/components/ui/button";
import { cn } from "~/utils";
import { createMentionExtension } from "~/lib/tiptap/mentionExtension";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

interface CommentEditorProps {
  projectId: number;
  initialContent?: JSONContent;
  onSubmit: (content: JSONContent) => void | Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
  submitLabel?: string;
  isLoading?: boolean;
  className?: string;
}

export function CommentEditor({
  projectId,
  initialContent,
  onSubmit,
  onCancel,
  placeholder = "Write a comment... (use @ to mention users)",
  submitLabel = "Post Comment",
  isLoading = false,
  className,
}: CommentEditorProps) {
  const t = useTranslations();
  const [isEmpty, setIsEmpty] = useState(true);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
      createMentionExtension(projectId),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: cn(
          "tiptap",
          "min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2",
          "text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50"
        ),
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText().trim();
      setIsEmpty(!text);
    },
  });

  const handleSubmit = async () => {
    if (!editor) return;

    const content = editor.getJSON();

    // Check if editor is empty
    const isEmpty =
      !content.content ||
      content.content.length === 0 ||
      (content.content.length === 1 &&
        content.content[0]?.type === "paragraph" &&
        (!content.content[0].content ||
          content.content[0].content.length === 0));

    if (isEmpty) {
      return;
    }

    await onSubmit(content);

    // Clear editor and refocus after successful submit
    editor.commands.clearContent();
    editor.commands.focus();
  };

  const handleCancel = () => {
    if (editor) {
      editor.commands.clearContent();
    }
    onCancel?.();
  };

  return (
    <div className={cn("space-y-2", className)}>
      <style>
        {`
          .tiptap p.is-editor-empty:first-child::before {
            color: hsl(var(--muted-foreground));
          }
        `}
      </style>
      <EditorContent editor={editor} />

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isLoading}
          >
            {t("common.cancel")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={isLoading || isEmpty}
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
