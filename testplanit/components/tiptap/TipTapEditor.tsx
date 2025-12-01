"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import styles from "~/styles/TipTapEditor.module.css";
import { Button } from "@/components/ui/button";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { Link } from "@tiptap/extension-link";
import { Emoji, EmojiItem, gitHubEmojis } from "@tiptap/extension-emoji";
import { Video } from "./video";
import { FileHandler } from "@tiptap/extension-file-handler";
import Focus from "@tiptap/extension-focus";
// import { Image } from "@tiptap/extension-image";
// import ImageResize from "tiptap-extension-resize-image";
import { ImageWithResize } from "./ImageWithResize";
import { Placeholder } from "@tiptap/extension-placeholder";
// Import browser-compatible generateJSON from core
import { generateJSON } from "@tiptap/core";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  StrikethroughIcon,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  LinkIcon,
  QuoteIcon,
  Code as CodeIcon,
  Code2 as CodeBlockIcon,
  Trash2,
  Upload,
  Undo2,
  Redo2,
  Smile,
  Check,
  Pilcrow,
  Heading3,
  Wand2,
  Loader2,
} from "lucide-react";
import LoadingSpinnerAlert from "../LoadingSpinnerAlert";
import { Separator } from "../ui/separator";
import { cn } from "~/utils";
import { useTranslations } from "next-intl";
import { emptyEditorContent } from "~/app/constants";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { useFindManyProjectLlmIntegration } from "~/lib/hooks/project-llm-integration";
import { tiptapToHtml } from "~/utils/tiptapToHtml";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TipTapEditorProps {
  content: object;
  onUpdate?: (content: object) => void;
  readOnly?: boolean;
  className?: string;
  projectId?: string; // Made optional - AI features only work when valid project ID provided
  placeholder?: string;
}

const TipTapEditor: React.FC<TipTapEditorProps> = ({
  content,
  onUpdate,
  readOnly = false,
  className = "h-[150px]",
  projectId,
  placeholder,
}) => {
  const t = useTranslations("common.editor");
  const tCommon = useTranslations("common");
  const tAi = useTranslations("common.ai");

  // Get LLM integrations for the project (only if valid projectId provided)
  const projectIdNumber = projectId ? parseInt(projectId) : NaN;
  const isValidProjectId = !isNaN(projectIdNumber) && projectIdNumber > 0;

  const { data: llmIntegrations } = useFindManyProjectLlmIntegration(
    {
      where: {
        projectId: projectIdNumber,
        isActive: true,
      },
      include: {
        llmIntegration: true,
      },
    },
    {
      enabled: isValidProjectId, // Only run query if projectId is valid
    }
  );
  const [linkUrl, setLinkUrl] = useState("");
  const [isLinkPopoverOpen, setIsLinkPopoverOpen] = useState(false);
  const [isEmojiPopoverOpen, setIsEmojiPopoverOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState("#000000");
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiHasError, setAiHasError] = useState(false);
  const [originalTextContent, setOriginalTextContent] = useState(""); // Separate state for original text display
  const [capturedContent, setCapturedContent] = useState<{
    textToProcess: string;
    displayText: string;
    plainText: string;
  } | null>(null);

  const handleImageUpload = useCallback(
    async (file: File): Promise<string | null> => {
      setLoading(true);
      try {
        const fileUrl = await fetchSignedUrl(
          file,
          "/api/get-docimage-url",
          `${projectId}/${file.name}`
        );
        return fileUrl;
      } catch (error) {
        console.error("Error uploading image:", error);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [projectId, setLoading]
  );

  const handleFile = useCallback(
    async (editor: any, files: File[], pos?: number) => {
      for (const file of files) {
        const fileUrl = await handleImageUpload(file);
        if (fileUrl) {
          if (file.type.startsWith("image/")) {
            editor
              .chain()
              .focus()
              .insertContentAt(pos ?? editor.state.doc.content.size, {
                type: "image",
                attrs: {
                  src: fileUrl,
                  align: "center",
                },
              })
              .run();
          } else if (file.type.startsWith("video/")) {
            editor
              .chain()
              .focus()
              .insertContentAt(pos ?? editor.state.doc.content.size, {
                type: "video",
                attrs: {
                  src: fileUrl,
                  controls: true,
                },
              })
              .run();
          }
        }
      }
    },
    [handleImageUpload]
  );

  const validateContent = (content: any) => {
    if (!content || typeof content !== "object" || !content.type) {
      return emptyEditorContent;
    }
    return content;
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        bulletList: {
          HTMLAttributes: {
            class: "list-disc list-outside pl-5",
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: "list-decimal list-outside pl-5",
          },
        },
        listItem: {
          HTMLAttributes: {
            class: "list-item",
          },
        },
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({ openOnClick: false }),
      ImageWithResize.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: {
          class: "tiptap-image",
        },
      }),
      Video,
      FileHandler.configure({
        allowedMimeTypes: [
          "image/png",
          "image/jpeg",
          "image/gif",
          "video/mp4",
          "video/webm",
          "video/ogg",
        ],
        onDrop: (editor, files, pos) => handleFile(editor, files, pos),
        onPaste: (editor, files) => handleFile(editor, files),
      }),
      Color,
      TextStyle,
      Emoji.configure({
        emojis: gitHubEmojis,
        enableEmoticons: true,
      }),
      Focus.configure({
        className: "ring-2 ring-offset-2 rounded-md ring-primary",
        mode: "shallowest",
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          "before:content-[attr(data-placeholder)] before:text-muted-foreground before:float-left before:pointer-events-none",
      }),
    ],
    content: validateContent(content),
    onUpdate: ({ editor }) => {
      if (onUpdate && editor) {
        try {
          const json = editor.getJSON();
          onUpdate(json);
        } catch (error) {
          console.warn(
            "Error in editor.getJSON, using emptyEditorContent as fallback",
            error
          );
          onUpdate(emptyEditorContent);
        }
      }
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-xs sm:prose-sm lg:prose max-w-none w-full focus:outline-none p-1",
        style: "width: 100%; max-width: none;",
      },
    },
    editable: !readOnly,
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [readOnly, editor, handleFile]);

  useEffect(() => {
    const editorContainer = editorContainerRef.current;
    if (!editorContainer) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files) {
        handleFile(editor, Array.from(e.dataTransfer.files));
      }
    };

    editorContainer.addEventListener("dragover", handleDragOver);
    editorContainer.addEventListener("drop", handleDrop);

    return () => {
      editorContainer.removeEventListener("dragover", handleDragOver);
      editorContainer.removeEventListener("drop", handleDrop);
    };
  }, [editor, handleFile]);

  if (!editor) {
    return null;
  }

  const handleLinkClick = () => {
    if (!editor) return;

    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setIsLinkPopoverOpen(true);
  };

  const applyLink = () => {
    if (!editor) return;
    if (linkUrl) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl })
        .run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setIsLinkPopoverOpen(false);
  };

  const removeLink = () => {
    if (!editor) return;
    editor.chain().focus().unsetLink().run();
    setIsLinkPopoverOpen(false);
  };

  const handleEmojiClick = (emoji: EmojiItem) => {
    if (!editor) return;
    if (emoji.emoji) {
      editor.chain().focus().insertContent(emoji.emoji).run();
    }
    setIsEmojiPopoverOpen(false);
  };

  const captureEditorContent = () => {
    if (!editor) return null;

    const selection = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(
      selection.from,
      selection.to
    );
    const allText = editor.getText();

    // Calculate what percentage of the document is selected
    const selectionRatio = selectedText.trim().length / allText.trim().length;

    // Only consider it a meaningful selection if:
    // 1. There's actually selected text (not just cursor position)
    // 2. The selection is not the entire document (less than 90%)
    // 3. The selection is substantial enough (more than 20% of the document)
    // 4. User likely made an intentional selection (not 80%+ which is often accidental)
    const hasSignificantSelection =
      selection.from !== selection.to && // Not just cursor position
      selectedText.trim().length > 0 && // Has actual content
      selectionRatio < 0.8 && // Not selecting most of the document (likely accidental)
      selectionRatio > 0.2; // Selection is substantial enough to be intentional

    if (hasSignificantSelection) {
      // Use selected text only - partial selection
      return {
        textToProcess: selectedText,
        displayText: selectedText,
        plainText: selectedText,
      };
    } else {
      // No meaningful selection, use all content with HTML formatting
      if (!allText.trim()) return null;

      // Get HTML for both AI processing and display
      const allContentJson = editor.getJSON();
      const htmlContent = tiptapToHtml(allContentJson);

      return {
        textToProcess: htmlContent,
        displayText: htmlContent,
        plainText: allText,
      };
    }
  };

  const aiPrompts = {
    improveWriting:
      "Improve the grammar, clarity, and flow of this text while maintaining its original meaning:",
    makeShorter:
      "Make this text more concise while keeping the key information:",
    makeLonger: "Expand this text with more detail and context:",
    fixGrammar: "Fix any grammatical errors in this text:",
    professional: "Rewrite this text in a professional tone:",
    casual: "Rewrite this text in a casual, friendly tone:",
    formal: "Rewrite this text in a formal tone:",
    summarize: "Summarize this text in a clear, concise way:",
    addExamples: "Add relevant examples or use cases to this text:",
    translate: (language: string) => `Translate this text to ${language}:`,
  };

  const handleAiPrompt = async (promptKey: string, language?: string) => {
    if (!editor) return;

    // Use the captured content - it should always be available when dropdown is open
    if (!capturedContent) {
      console.error("No captured content available - this should not happen");
      return;
    }

    // Set the display content
    setOriginalTextContent(capturedContent.displayText);

    // Select all if we're using full document
    if (
      capturedContent.textToProcess === capturedContent.displayText &&
      capturedContent.displayText.includes("<")
    ) {
      editor.chain().focus().selectAll().run();
    }

    const prompt =
      language && promptKey === "translate"
        ? aiPrompts.translate(language)
        : (aiPrompts[promptKey as keyof typeof aiPrompts] as string);

    setIsAiDialogOpen(true);

    await processAiRequest(prompt, capturedContent.textToProcess);
  };

  const processAiRequest = async (prompt: string, text: string) => {
    if (!llmIntegrations?.length || !isValidProjectId) return;

    setIsAiLoading(true);
    setAiResponse("");
    setAiHasError(false);

    try {
      const activeLlm = llmIntegrations[0]; // Use first active LLM

      const response = await fetch(`/api/llm/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          llmIntegrationId: activeLlm.llmIntegrationId,
          message: `${prompt}\n\n"${text}"`,
          projectId: projectIdNumber,
          feature: "editor-assistant",
        }),
      });

      if (!response.ok) {
        // Try to get error message from response
        let errorMessage = `HTTP ${response.status}: Failed to get AI response`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch (parseError) {
          // Keep the default error message if we can't parse the response
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (data.success) {
        setAiResponse(data.response?.content || "No response received");
      } else {
        throw new Error(data.error || "Unknown error occurred");
      }
    } catch (error) {
      console.error("AI request failed:", error);
      console.error(
        "Error message:",
        error instanceof Error ? error.message : String(error)
      );

      let userMessage = tAi("errors.generic");

      if (error instanceof Error) {
        const message = error.message.toLowerCase();

        if (
          message.includes("safety") ||
          message.includes("blocked") ||
          message.includes("content filtering")
        ) {
          userMessage = tAi("errors.contentBlocked");
        } else if (message.includes("empty content")) {
          userMessage = tAi("errors.emptyContent");
        } else if (
          message.includes("too long") ||
          message.includes("truncated") ||
          message.includes("shorter request") ||
          message.includes("concise response")
        ) {
          userMessage = tAi("errors.maxTokens");
        } else if (
          message.includes("rate limit") ||
          message.includes("quota")
        ) {
          userMessage = tAi("errors.rateLimit");
        } else if (
          message.includes("access denied") ||
          message.includes("forbidden")
        ) {
          userMessage = tAi("errors.accessDenied");
        }
      }

      setAiResponse(userMessage);
      setAiHasError(true);
    } finally {
      setIsAiLoading(false);
    }
  };

  const acceptAiSuggestion = () => {
    if (!editor || !aiResponse) return;

    // Convert the AI response to proper TipTap JSON format
    let contentToInsert: any;

    try {
      // First, normalize list items that have extra blank lines between them
      const normalizedResponse = aiResponse
        // Combine bullet list items separated by blank lines
        .replace(/(^|\n)([\*\-•]\s.*?)(\n\n+(?=[\*\-•]\s))/gm, "$1$2\n")
        // Combine numbered list items separated by blank lines
        .replace(/(^|\n)(\d+[\.\)]\s.*?)(\n\n+(?=\d+[\.\)]\s))/gm, "$1$2\n")
        // Clean up any remaining excessive blank lines
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      // Convert to HTML with proper structure
      const htmlContent = normalizedResponse
        .split("\n\n")
        .map((paragraph) => {
          // Check if it's a bullet list
          if (paragraph.match(/^[\*\-•]\s/m)) {
            const items = paragraph
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => `<li>${line.replace(/^[\*\-•]\s*/, "")}</li>`)
              .join("");
            return `<ul>${items}</ul>`;
          }
          // Check if it's a numbered list
          else if (paragraph.match(/^\d+[\.\)]\s/m)) {
            const items = paragraph
              .split("\n")
              .filter((line) => line.trim())
              .map((line) => `<li>${line.replace(/^\d+[\.\)]\s*/, "")}</li>`)
              .join("");
            return `<ol>${items}</ol>`;
          }
          // Regular paragraph
          else if (paragraph.trim()) {
            return `<p>${paragraph}</p>`;
          }
          return "";
        })
        .filter((html) => html)
        .join("");

      // Convert HTML to TipTap JSON using the same extensions as the editor
      const extensions = [
        StarterKit.configure({
          link: false,
          underline: false,
        }),
        Underline,
        Link,
        ImageWithResize.configure({
          inline: true,
          allowBase64: true,
        }),
        Video,
        Color,
        TextStyle,
        Emoji.configure({
          emojis: gitHubEmojis,
        }),
      ];

      contentToInsert = generateJSON(htmlContent, extensions);
    } catch (error) {
      console.error("Error converting AI response to TipTap format:", error);
      // Fallback to plain text if conversion fails
      contentToInsert = aiResponse;
    }

    const selection = editor.state.selection;
    if (selection.from !== selection.to) {
      // Replace selected text
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent(contentToInsert)
        .run();
    } else {
      // Replace all content
      editor
        .chain()
        .focus()
        .selectAll()
        .deleteSelection()
        .insertContent(contentToInsert)
        .run();
    }

    // Reset all AI dialog state
    setIsAiDialogOpen(false);
    setAiResponse("");
    setOriginalTextContent("");
    setAiHasError(false);
    setCapturedContent(null);
  };

  const rejectAiSuggestion = () => {
    // Reset all AI dialog state
    setIsAiDialogOpen(false);
    setAiResponse("");
    setOriginalTextContent("");
    setAiHasError(false);
    setCapturedContent(null);

    // Clear any editor selection to ensure consistent behavior on next interaction
    if (editor) {
      // Move cursor to start and clear selection
      editor.commands.focus();
      editor.commands.setTextSelection(0);
    }
  };

  return (
    <div
      className={cn("overflow-auto flex flex-col w-full", className)}
      ref={editorContainerRef}
    >
      {loading && <LoadingSpinnerAlert />}
      {!readOnly && (
        <div className="flex px-0.5 p-1.5 bg-muted border-t sticky bottom-0 z-10 overflow-x-auto whitespace-nowrap sm:relative sm:border-b gap-0.5 w-full">
          <input
            title={t("setColor")}
            className="w-4 h-8 min-w-4"
            type="color"
            value={color}
            onChange={(event) => {
              const newColor = event.target.value;
              setColor(newColor);
              editor.chain().focus().setColor(newColor).run();
            }}
            data-testid="setColor"
          />
          <Button
            type="button"
            variant={editor.isActive("bold") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("italic") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("strike") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <StrikethroughIcon className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("underline") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("code") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <CodeIcon className="w-4 h-4" />
          </Button>
          <Separator orientation="vertical" className="p-0.5 mx-0.5" />

          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="p-2">
                {editor.isActive("heading", { level: 1 }) && <Heading1 />}
                {editor.isActive("heading", { level: 2 }) && <Heading2 />}
                {editor.isActive("heading", { level: 3 }) && <Heading3 />}
                {editor.isActive("paragraph") && <Pilcrow />}
                {editor.isActive("codeBlock") && <CodeBlockIcon />}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full flex justify-between"
                onClick={() => editor.chain().focus().setParagraph().run()}
              >
                <Pilcrow size={16} />
                {editor.isActive("paragraph") && <Check size={16} />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full flex justify-between"
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level: 1 }).run()
                }
              >
                <Heading1 size={16} />
                {editor.isActive("heading", { level: 1 }) && (
                  <Check size={16} />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full flex justify-between"
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                <Heading2 size={16} />
                {editor.isActive("heading", { level: 2 }) && (
                  <Check size={16} />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full flex justify-between"
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level: 3 }).run()
                }
              >
                <Heading3 size={16} />
                {editor.isActive("heading", { level: 3 }) && (
                  <Check size={16} />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full flex justify-between"
                onClick={() => editor.chain().focus().setCodeBlock().run()}
              >
                <CodeBlockIcon size={16} />
                {editor.isActive("codeBlock") && <Check size={16} />}
              </Button>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            variant={editor.isActive("bulletList") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("orderedList") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("blockquote") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <QuoteIcon className="w-4 h-4" />
          </Button>

          <Separator orientation="vertical" className="p-0.5 mx-0.5" />

          {isValidProjectId &&
            llmIntegrations &&
            llmIntegrations.length > 0 && (
              <DropdownMenu
                onOpenChange={(open) => {
                  if (open) {
                    // Always capture content fresh when opening dropdown
                    // This ensures we get current selection state
                    const content = captureEditorContent();
                    setCapturedContent(content);
                  } else {
                    // Reset captured content when dropdown closes
                    // This ensures fresh capture on next interaction
                    setCapturedContent(null);
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="p-2"
                    title={tAi("title")}
                  >
                    <Wand2 className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuItem
                    onClick={() => handleAiPrompt("improveWriting")}
                  >
                    {tAi("improveWriting")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleAiPrompt("makeShorter")}
                  >
                    {tAi("makeShorter")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleAiPrompt("makeLonger")}
                  >
                    {tAi("makeLonger")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleAiPrompt("fixGrammar")}
                  >
                    {tAi("fixGrammar")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {tAi("changeTone")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onClick={() => handleAiPrompt("professional")}
                      >
                        {tAi("professional")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAiPrompt("casual")}
                      >
                        {tAi("casual")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAiPrompt("formal")}
                      >
                        {tAi("formal")}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      {tAi("translate")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        onClick={() => handleAiPrompt("translate", "Spanish")}
                      >
                        {tAi("spanish")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAiPrompt("translate", "French")}
                      >
                        {tAi("french")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAiPrompt("translate", "German")}
                      >
                        {tAi("german")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          handleAiPrompt("translate", "Portuguese")
                        }
                      >
                        {tAi("portuguese")}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleAiPrompt("summarize")}>
                    {tAi("summarize")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleAiPrompt("addExamples")}
                  >
                    {tAi("addExamples")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

          <Popover open={isLinkPopoverOpen} onOpenChange={setIsLinkPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant={editor.isActive("link") ? "default" : "outline"}
                size="sm"
                className="p-2"
                onClick={handleLinkClick}
              >
                <LinkIcon className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-2 w-60 flex flex-col gap-2">
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder={t("enterUrl")}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={applyLink}
                  className="flex-1"
                >
                  {tCommon("actions.apply")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={removeLink}
                  className="flex-1"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Popover
            open={isEmojiPopoverOpen}
            onOpenChange={setIsEmojiPopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEmojiPopoverOpen(true)}
              >
                <Smile className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-2 w-60 max-h-80 flex flex-col gap-2 overflow-auto">
              <div className="grid grid-cols-8 gap-2">
                {gitHubEmojis.map((emoji) => (
                  <button
                    key={emoji.name}
                    className="text-xl"
                    onClick={() => handleEmojiClick(emoji)}
                  >
                    {emoji.emoji}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="p-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" />
          </Button>

          <input
            title={t("uploadFile")}
            type="file"
            accept="image/*, video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) {
                handleFile(editor, Array.from(e.target.files));
              }
            }}
            ref={fileInputRef}
            multiple
          />

          <Separator orientation="vertical" className="p-0.5 mx-0.5" />

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
          >
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
          >
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>
      )}
      <div className="overflow-y-auto flex-1 w-full">
        <EditorContent
          editor={editor}
          className={`mt-0.5 border-accent-foreground/10 border rounded-lg prose prose-xs sm:prose-sm lg:prose xl:prose-lg max-w-none w-full focus:outline-none ${styles.editorContent}`}
        />
      </div>

      {/* AI Assistant Dialog */}
      <Dialog
        open={isAiDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            // Dialog is being closed, clean up state
            rejectAiSuggestion();
          } else {
            setIsAiDialogOpen(true);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tAi("title")}</DialogTitle>
            <DialogDescription className="sr-only">
              {tAi("title")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium mb-2">{tAi("originalText")}:</h4>
              <div className="p-3 bg-muted rounded text-sm h-64 overflow-y-auto">
                {originalTextContent && originalTextContent.includes("<") ? (
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: originalTextContent }}
                  />
                ) : (
                  <div className="whitespace-pre-wrap">
                    {originalTextContent}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">{tAi("suggestion")}:</h4>
              <div className="p-3 border rounded h-64 overflow-y-auto">
                {isAiLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="ml-2">{tAi("generating")}</span>
                  </div>
                ) : (
                  <div
                    className="prose prose-sm max-w-none text-sm"
                    dangerouslySetInnerHTML={{
                      __html: aiResponse || tAi("noSuggestion"),
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={rejectAiSuggestion}
              disabled={isAiLoading}
            >
              {tCommon("actions.cancel")}
            </Button>
            <Button
              type="button"
              onClick={acceptAiSuggestion}
              disabled={isAiLoading || !aiResponse || aiHasError}
            >
              {tAi("acceptSuggestion")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TipTapEditor;
