"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { Color } from "@tiptap/extension-color";
import { Emoji, EmojiItem, gitHubEmojis } from "@tiptap/extension-emoji";
import { FileHandler } from "@tiptap/extension-file-handler";
import Focus from "@tiptap/extension-focus";
import { Link } from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "~/app/extensions/Table";
import { TableColumnMenu, TableRowMenu } from "~/app/extensions/Table/menus";
import { findTable } from "~/app/extensions/Table/utils";
import styles from "~/styles/TipTapEditor.module.css";
import { ContentItemMenu } from "./menus/ContentItemMenu";
import { Video } from "./video";
// import { Image } from "@tiptap/extension-image";
// import ImageResize from "tiptap-extension-resize-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { Slice } from "@tiptap/pm/model";
import { ImageWithResize } from "./ImageWithResize";
// Import browser-compatible generateJSON from core
import {
  convertMarkdownToTipTapJSON,
  isLikelyMarkdown,
} from "~/utils/tiptapConversion";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Check,
  Code as CodeIcon,
  Code2 as CodeBlockIcon,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  LinkIcon,
  List,
  ListOrdered,
  Loader2,
  PanelTop,
  Pilcrow,
  QuoteIcon,
  Redo2,
  Rows3,
  Smile,
  StrikethroughIcon,
  Table2,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { emptyEditorContent } from "~/app/constants";
import {
  createParameterMentionExtension,
  type ParameterChipMeta,
} from "~/lib/tiptap/parameterMentionExtension";
import { cn } from "~/utils";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { tiptapToHtml } from "~/utils/tiptapToHtml";
import LoadingSpinnerAlert from "../LoadingSpinnerAlert";
import { Separator } from "../ui/separator";
import { InsertParameterToolbarButton } from "./InsertParameterToolbarButton";
import { UndeclaredParameterWarning } from "./UndeclaredParameterWarning";

interface TipTapEditorProps {
  content: object;
  onUpdate?: (content: object) => void;
  readOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
  projectId?: string; // Made optional - AI features only work when valid project ID provided
  placeholder?: string;
  parameters?: ParameterChipMeta[];
  onOpenParametersSheet?: () => void;
}

const TipTapEditor: React.FC<TipTapEditorProps> = ({
  content,
  onUpdate,
  readOnly = false,
  className = "h-[150px]",
  style,
  projectId,
  placeholder,
  parameters,
  onOpenParametersSheet,
}) => {
  const t = useTranslations("common.editor");
  const tCommon = useTranslations("common");
  const tAi = useTranslations("common.ai");
  const tParams = useTranslations("parameters");

  const chipMessages = useMemo(
    () => ({
      clickToReveal: tParams("chipClickToReveal"),
      copyValue: tParams("chipCopyValue"),
      copyAriaLabel: (label: string) => tParams("chipCopyAriaLabel", { label }),
      copiedToast: (label: string) => tParams("chipCopiedToast", { label }),
      copyFailedToast: (label: string) =>
        tParams("chipCopyFailedToast", { label }),
    }),
    [tParams]
  );

  // Get LLM integrations for the project (only if valid projectId provided)
  const projectIdNumber = projectId ? parseInt(projectId) : NaN;
  const isValidProjectId = !isNaN(projectIdNumber) && projectIdNumber > 0;

  const { data: llmIntegrations } = useClientQueries(
    schema
  ).projectLlmIntegration.useFindMany(
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

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: {
            levels: [1, 2, 3],
          },
          bulletList: {
            HTMLAttributes: {
              class: "list-disc list-outside ps-5",
            },
          },
          orderedList: {
            HTMLAttributes: {
              class: "list-decimal list-outside ps-5",
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
          // Images are block-level (the custom Image extension sets group:"block",
          // and all stored content uses block-placed images). inline:true here
          // contradicted that — a node flagged inline but placed at block level —
          // which @tiptap 3.26 tolerated but 3.27's stricter content validation
          // rejects ("contentMatchAt … invalid content"), crashing the DragHandle
          // on any doc with an image. Keep it block so v2 image content renders.
          inline: false,
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
            "before:content-[attr(data-placeholder)] before:text-muted-foreground before:float-start before:pointer-events-none",
        }),
        Markdown,
        Table,
        TableRow,
        TableCell,
        TableHeader,
        // Always register the parameterMention NODE so step content that
        // contains parameter references can deserialize on every surface
        // — even read-only previews / list cells / case views without an
        // active iteration. The `@`-trigger Suggestion popup is opt-in
        // (param-aware editable editors only); read-only or param-less
        // mounts get a registered schema node that renders `@label` and
        // never crashes. See parameterMentionExtension.tsx for the
        // CreateParameterMentionExtensionOptions contract.
        createParameterMentionExtension(parameters ?? [], chipMessages, {
          withSuggestion: !readOnly && (parameters?.length ?? 0) > 0,
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
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData("text/plain");
          if (!text || !isLikelyMarkdown(text)) {
            return false;
          }
          try {
            const json = convertMarkdownToTipTapJSON(text);
            const doc = view.state.schema.nodeFromJSON(json);
            const slice = new Slice(doc.content, 0, 0);
            const tr = view.state.tr.replaceSelection(slice);
            view.dispatch(tr);
            return true;
          } catch (error) {
            console.warn("Failed to parse pasted markdown:", error);
            return false;
          }
        },
      },
      editable: !readOnly,
      // chipMessages intentionally omitted from deps: useTranslations may return
      // a new function ref on every render, which would cause an infinite editor
      // re-mount loop. Locale changes already remount the layout above.
    },
    [parameters]
  );

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
        void handleFile(editor, Array.from(e.dataTransfer.files));
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
        } catch {
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

    // Convert the AI response (typically markdown from LLMs) to TipTap JSON
    let contentToInsert: any;

    try {
      contentToInsert = convertMarkdownToTipTapJSON(aiResponse);
    } catch (error) {
      console.error("Error converting AI response to TipTap format:", error);
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
      style={style}
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
            data-testid="tiptap-bold"
            aria-label={t("bold")}
          >
            <Bold className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("italic") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            data-testid="tiptap-italic"
            aria-label={t("italic")}
          >
            <Italic className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("strike") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            data-testid="tiptap-strikethrough"
            aria-label={t("strikethrough")}
          >
            <StrikethroughIcon className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("underline") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            data-testid="tiptap-underline"
            aria-label={t("underline")}
          >
            <UnderlineIcon className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("code") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleCode().run()}
            data-testid="tiptap-code"
            aria-label={t("code")}
          >
            <CodeIcon className="w-4 h-4" />
          </Button>
          <Separator orientation="vertical" className="p-0.5 mx-0.5" />

          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="p-2"
                data-testid="tiptap-heading-trigger"
                aria-label={t("heading")}
              >
                {editor.isActive("heading", { level: 1 }) && <Heading1 />}
                {editor.isActive("heading", { level: 2 }) && <Heading2 />}
                {editor.isActive("heading", { level: 3 }) && <Heading3 />}
                {editor.isActive("paragraph") && <Pilcrow />}
                {editor.isActive("codeBlock") && <CodeBlockIcon />}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-full p-1"
              data-testid="tiptap-heading-menu"
            >
              <Button
                type="button"
                variant="ghost"
                className="w-full flex justify-between"
                onClick={() => editor.chain().focus().setParagraph().run()}
                data-testid="tiptap-paragraph"
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
                data-testid="tiptap-heading-1"
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
                data-testid="tiptap-heading-2"
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
                data-testid="tiptap-heading-3"
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
                data-testid="tiptap-code-block"
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
            data-testid="tiptap-bullet-list"
            aria-label={t("bulletList")}
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("orderedList") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            data-testid="tiptap-ordered-list"
            aria-label={t("orderedList")}
          >
            <ListOrdered className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant={editor.isActive("blockquote") ? "default" : "outline"}
            size="sm"
            className="p-2"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            data-testid="tiptap-blockquote"
            aria-label={t("blockquote")}
          >
            <QuoteIcon className="w-4 h-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant={editor.isActive("table") ? "default" : "outline"}
                size="sm"
                className="p-2"
                data-testid="tiptap-table-trigger"
                aria-label={t("table.insertTable")}
              >
                <Table2 className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-1"
              data-testid="tiptap-table-menu"
            >
              <Button
                type="button"
                variant="ghost"
                className="w-full flex gap-2 justify-start"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
                }
                data-testid="tiptap-insert-table"
              >
                <Table2 size={16} />
                {t("table.insertTable")}
              </Button>
              {editor.isActive("table") && (
                <>
                  <Separator className="my-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex gap-2 justify-between"
                    onClick={() =>
                      editor.chain().focus().toggleHeaderRow().run()
                    }
                    data-testid="tiptap-toggle-header-row"
                  >
                    <span className="flex gap-2 items-center">
                      <PanelTop size={16} />
                      {t("table.headerRow")}
                    </span>
                    {findTable(editor.state.selection)?.node.firstChild
                      ?.firstChild?.type.name === "tableHeader" && (
                      <Check size={16} />
                    )}
                  </Button>
                  <Separator className="my-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex gap-2 justify-start"
                    onClick={() =>
                      editor.chain().focus().addColumnBefore().run()
                    }
                    data-testid="tiptap-add-col-before"
                  >
                    <BetweenVerticalEnd size={16} />
                    {t("table.addColumnBefore")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex gap-2 justify-start"
                    onClick={() =>
                      editor.chain().focus().addColumnAfter().run()
                    }
                    data-testid="tiptap-add-col-after"
                  >
                    <BetweenVerticalStart size={16} />
                    {t("table.addColumnAfter")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex gap-2 justify-start text-destructive"
                    onClick={() => editor.chain().focus().deleteColumn().run()}
                    data-testid="tiptap-delete-col"
                  >
                    <Columns3 size={16} />
                    {t("table.deleteColumn")}
                  </Button>
                  <Separator className="my-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex gap-2 justify-start"
                    onClick={() => editor.chain().focus().addRowBefore().run()}
                    data-testid="tiptap-add-row-before"
                  >
                    <BetweenHorizontalEnd size={16} />
                    {t("table.addRowBefore")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex gap-2 justify-start"
                    onClick={() => editor.chain().focus().addRowAfter().run()}
                    data-testid="tiptap-add-row-after"
                  >
                    <BetweenHorizontalStart size={16} />
                    {t("table.addRowAfter")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex gap-2 justify-start text-destructive"
                    onClick={() => editor.chain().focus().deleteRow().run()}
                    data-testid="tiptap-delete-row"
                  >
                    <Rows3 size={16} />
                    {t("table.deleteRow")}
                  </Button>
                  <Separator className="my-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full flex gap-2 justify-start text-destructive"
                    onClick={() => editor.chain().focus().deleteTable().run()}
                    data-testid="tiptap-delete-table"
                  >
                    <Trash2 size={16} />
                    {t("table.deleteTable")}
                  </Button>
                </>
              )}
            </PopoverContent>
          </Popover>

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
                        onClick={() => handleAiPrompt("translate", "English")}
                      >
                        {tAi("english")}
                      </DropdownMenuItem>
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

          {parameters && parameters.length > 0 && editor && (
            <InsertParameterToolbarButton
              editor={editor}
              parameters={parameters}
              onOpenSheet={onOpenParametersSheet}
            />
          )}

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
            <PopoverContent
              className="p-2 w-60 max-h-80 flex flex-col gap-2 overflow-auto"
              onWheel={(e) => e.stopPropagation()}
            >
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
                void handleFile(editor, Array.from(e.target.files));
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
      {parameters !== undefined && (
        <style>{`
          .parameter-ref-chip {
            display: inline-flex;
            align-items: center;
            gap: 0.125rem;
            padding: 0 0.375rem;
            border-radius: 0.25rem;
            background-color: hsl(var(--primary) / 0.10);
            color: hsl(var(--primary));
            font-family: ui-monospace, "SFMono-Regular", monospace;
            font-size: 0.8125rem;
            font-weight: 500;
            line-height: 1.4;
            vertical-align: baseline;
            white-space: nowrap;
            cursor: default;
            user-select: all;
          }
          .parameter-ref-chip[data-undeclared="true"] {
            background-color: hsl(var(--warning) / 0.10);
            color: hsl(var(--warning-foreground));
            text-decoration: underline wavy hsl(var(--warning));
            text-underline-offset: 2px;
          }
          .parameter-ref-chip[data-focused="true"] {
            outline: 2px solid hsl(var(--ring));
            outline-offset: 1px;
          }
          .parameter-ref-chip-text {
            user-select: text;
          }
          .parameter-ref-chip[data-sensitive="true"] {
            cursor: pointer;
          }
          .parameter-ref-chip[data-sensitive="true"]:hover {
            background-color: hsl(var(--primary) / 0.18);
          }
          /* The parent button is just a positioning/event target — no mask
             on it, otherwise the ping pseudo-element's scaled output gets
             clipped to the original icon shape. The icon itself is drawn
             by ::before; the ping pulse by ::after. */
          .parameter-ref-chip-copy {
            position: relative;
            display: inline-block;
            width: 14px;
            height: 14px;
            margin-left: 0.375rem;
            cursor: pointer;
            user-select: none;
          }
          .parameter-ref-chip-copy::before,
          .parameter-ref-chip-copy::after {
            content: "";
            position: absolute;
            inset: 0;
            background-color: currentColor;
            -webkit-mask: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='14' height='14' x='8' y='8' rx='2' ry='2'/%3E%3Cpath d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'/%3E%3C/svg%3E") no-repeat center / contain;
                    mask: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='14' height='14' x='8' y='8' rx='2' ry='2'/%3E%3Cpath d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'/%3E%3C/svg%3E") no-repeat center / contain;
            transform-origin: center;
            pointer-events: none;
          }
          /* ::before is the static icon */
          .parameter-ref-chip-copy::before {
            opacity: 0.85;
            transition: opacity 120ms, background-color 120ms;
          }
          .parameter-ref-chip-copy:hover::before {
            opacity: 1;
          }
          /* ::after is the ping pulse — invisible by default */
          .parameter-ref-chip-copy::after {
            opacity: 0;
          }
          .parameter-ref-chip-copy[data-copied="true"]::before {
            opacity: 1;
            background-color: hsl(var(--success, 142 70% 45%));
          }
          .parameter-ref-chip-copy[data-copied="true"]::after {
            background-color: hsl(var(--success, 142 70% 45%));
            animation: chip-copy-ping 600ms cubic-bezier(0, 0, 0.2, 1) 1;
          }
          @keyframes chip-copy-ping {
            0%   { transform: scale(1);   opacity: 0.7; }
            100% { transform: scale(2.4); opacity: 0;   }
          }
        `}</style>
      )}
      <div className="overflow-y-auto flex-1 w-full relative">
        <ContentItemMenu editor={editor} editable={!readOnly} />
        <EditorContent
          editor={editor}
          className={`mt-0.5 ${!readOnly ? "ps-3 border-4 border-primary/20" : ""} border-accent-foreground/10 border rounded-lg prose prose-xs sm:prose-sm lg:prose xl:prose-lg max-w-none w-full focus:outline-none ${styles.editorContent}`}
        />
      </div>
      {parameters && parameters.length > 0 && editor && (
        <UndeclaredParameterWarning
          editorJson={editor.getJSON() ?? null}
          declaredNames={parameters.map((p) => p.name)}
        />
      )}
      {!readOnly && editor && (
        <>
          <TableRowMenu editor={editor} />
          <TableColumnMenu editor={editor} />
        </>
      )}

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
                    <span className="ms-2">{tAi("generating")}</span>
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
              {tCommon("cancel")}
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
