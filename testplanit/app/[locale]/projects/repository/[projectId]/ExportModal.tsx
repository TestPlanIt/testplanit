import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

// Interface for the props the modal will receive
interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => Promise<void>; // Make onExport async
  totalCases: number;
  selectedCaseIds: number[];
  totalProjectCases?: number;
}

// Interface for the export options chosen by the user
export interface ExportOptions {
  scope: "selected" | "allFiltered" | "allProject";
  format: "csv" | "pdf";
  columns: "visible" | "all";
  delimiter: "," | ";" | ":" | "|";
  textLongFormat: "json" | "plainText";
  attachmentFormat: "json" | "names" | "embedded";
  stepsFormat: "json" | "plainText";
  rowMode: "single" | "multi";
}

export function ExportModal({
  isOpen,
  onClose,
  onExport,
  totalCases,
  selectedCaseIds,
  totalProjectCases,
}: ExportModalProps) {
  // Get translations - requires namespace to be added to messages files
  const t = useTranslations("repository.cases.exportModal");
  const tGlobal = useTranslations();

  // State for the selected options
  const [scope, setScope] = useState<"selected" | "allFiltered" | "allProject">(
    "selected"
  );
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [columns, setColumns] = useState<"visible" | "all">("all");
  const [delimiter, setDelimiter] = useState<"," | ";" | ":" | "|">(",");
  const [textLongFormat, setTextLongFormat] = useState<"json" | "plainText">(
    "json"
  );
  const [attachmentFormat, setAttachmentFormat] = useState<
    "json" | "names" | "embedded"
  >("json");
  const [stepsFormat, setStepsFormat] = useState<"json" | "plainText">("json");
  const [rowMode, setRowMode] = useState<"single" | "multi">("single");
  const [isExporting, setIsExporting] = useState(false);

  const canExportSelected = selectedCaseIds.length > 0;

  // Effect to reset scope if selection becomes empty or modal opens
  useEffect(() => {
    if (isOpen) {
      if (canExportSelected) {
        setScope("selected");
      } else {
        setScope("allFiltered");
      }
      // Reset other fields to default when modal opens
      setFormat("csv");
      setColumns("all");
      setDelimiter(",");
      setTextLongFormat("json");
      setAttachmentFormat("json");
      setStepsFormat("json");
      setRowMode("single");
      setIsExporting(false);
    }
  }, [isOpen, canExportSelected]);

  // Set default attachment format based on export format
  useEffect(() => {
    if (format === "pdf") {
      setAttachmentFormat("names");
    } else {
      setAttachmentFormat("json");
    }
  }, [format]);

  const handleExportClick = async () => {
    setIsExporting(true);
    try {
      await onExport({
        scope,
        format,
        columns,
        delimiter,
        textLongFormat,
        attachmentFormat,
        stepsFormat,
        rowMode,
      });
    } catch (error) {
      console.error("Export failed inside modal:", error);
      toast.error(tGlobal("repository.exportModal.exportError"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && !isExporting && onClose()}
    >
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{tGlobal("repository.exportModal.title")}</DialogTitle>
          <DialogDescription>{tGlobal("repository.exportModal.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          {/* Export Scope */}
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <Label
              htmlFor="scope"
              className="text-right whitespace-nowrap shrink-0 flex items-center"
            >
              {tGlobal("repository.cases.export")}
              <HelpPopover helpKey="exportModal.scope" />
            </Label>
            <RadioGroup
              id="scope"
              value={scope}
              onValueChange={(
                value: "selected" | "allFiltered" | "allProject"
              ) => setScope(value)}
              className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
              data-testid="export-scope-radio-group"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="selected"
                  id="scope-selected"
                  disabled={!canExportSelected}
                  data-testid="export-scope-selected"
                />
                <Label
                  htmlFor="scope-selected"
                  className={
                    !canExportSelected
                      ? "text-muted-foreground cursor-not-allowed"
                      : "cursor-pointer"
                  }
                >
                  {tGlobal("repository.exportModal.scope.selected", { count: selectedCaseIds.length })}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="allFiltered"
                  id="scope-allFiltered"
                  data-testid="export-scope-allFiltered"
                />
                <Label htmlFor="scope-allFiltered" className="cursor-pointer">
                  {t("scope.allFiltered", { count: totalCases })}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="allProject"
                  id="scope-allProject"
                  data-testid="export-scope-allProject"
                />
                <Label htmlFor="scope-allProject" className="cursor-pointer">
                  {tGlobal("repository.exportModal.scope.allProject", { count: totalProjectCases ?? 0 })}
                </Label>
              </div>
            </RadioGroup>
          </div>
          {/* Export Format */}
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <Label
              htmlFor="format"
              className="text-right whitespace-nowrap shrink-0 flex items-center"
            >
              {tGlobal("repository.exportModal.format.label")}
              <HelpPopover helpKey="exportModal.format" />
            </Label>
            <RadioGroup
              id="format"
              value={format}
              onValueChange={(value: "csv" | "pdf") => setFormat(value)}
              className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
              data-testid="export-format-radio-group"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="csv"
                  id="format-csv"
                  data-testid="export-format-csv"
                />
                <Label htmlFor="format-csv" className="cursor-pointer">
                  {tGlobal("repository.exportModal.format.csv")}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="pdf"
                  id="format-pdf"
                  data-testid="export-format-pdf"
                />
                <Label htmlFor="format-pdf" className="cursor-pointer">
                  {tGlobal("repository.exportModal.format.pdf")}
                </Label>
              </div>
            </RadioGroup>
          </div>
          {/* CSV Specific Options */}
          {format === "csv" && (
            <>
              {/* Export Columns */}
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <Label
                  htmlFor="columns"
                  className="text-right whitespace-nowrap shrink-0 flex items-center"
                >
                  {tGlobal("common.table.columns.columns")}
                  <HelpPopover helpKey="exportModal.columns" />
                </Label>
                <RadioGroup
                  id="columns"
                  value={columns}
                  onValueChange={(value: "visible" | "all") =>
                    setColumns(value)
                  }
                  className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
                  data-testid="export-columns-radio-group"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="all"
                      id="columns-all"
                      data-testid="export-columns-all"
                    />
                    <Label htmlFor="columns-all" className="cursor-pointer">
                      {tGlobal("repository.exportModal.columns.all")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="visible"
                      id="columns-visible"
                      data-testid="export-columns-visible"
                    />
                    <Label htmlFor="columns-visible" className="cursor-pointer">
                      {tGlobal("repository.exportModal.columns.visible")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Delimiter */}
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <Label
                  htmlFor="delimiter"
                  className="text-right whitespace-nowrap shrink-0 flex items-center"
                >
                  {tGlobal("repository.exportModal.delimiter.label")}
                  <HelpPopover helpKey="exportModal.delimiter" />
                </Label>
                <div className="w-[180px] shrink-0">
                  <Select
                    value={delimiter}
                    onValueChange={(value: "," | ";" | ":" | "|") =>
                      setDelimiter(value)
                    }
                    data-testid="export-delimiter-select"
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tGlobal("repository.exportModal.delimiter.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="," data-testid="delimiter-comma">
                        {tGlobal("repository.exportModal.delimiter.comma")}
                      </SelectItem>
                      <SelectItem value=";" data-testid="delimiter-semicolon">
                        {tGlobal("repository.exportModal.delimiter.semicolon")}
                      </SelectItem>
                      <SelectItem value=":" data-testid="delimiter-colon">
                        {tGlobal("repository.exportModal.delimiter.colon")}
                      </SelectItem>
                      <SelectItem value="|" data-testid="delimiter-pipe">
                        {tGlobal("repository.exportModal.delimiter.pipe")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Text Long Format */}
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <Label
                  htmlFor="textLongFormat"
                  className="text-right whitespace-nowrap shrink-0 flex items-center"
                >
                  {t("textLongFormat.label")}
                  <HelpPopover helpKey="exportModal.textLongFormat" />
                </Label>
                <RadioGroup
                  id="textLongFormat"
                  value={textLongFormat}
                  onValueChange={(value: "json" | "plainText") =>
                    setTextLongFormat(value)
                  }
                  className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
                  data-testid="export-textlong-format-radio-group"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="json"
                      id="textLongFormat-json"
                      data-testid="export-textlong-json"
                    />
                    <Label
                      htmlFor="textLongFormat-json"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.textLongFormat.json")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="plainText"
                      id="textLongFormat-plainText"
                      data-testid="export-textlong-plainText"
                    />
                    <Label
                      htmlFor="textLongFormat-plainText"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.textLongFormat.plainText")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Steps Format */}
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <Label
                  htmlFor="stepsFormat"
                  className="text-right whitespace-nowrap shrink-0 flex items-center"
                >
                  {tGlobal("repository.exportModal.stepsFormat.label")}
                  <HelpPopover helpKey="exportModal.stepsFormat" />
                </Label>
                <RadioGroup
                  id="stepsFormat"
                  value={stepsFormat}
                  onValueChange={(value: "json" | "plainText") =>
                    setStepsFormat(value)
                  }
                  className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
                  data-testid="export-steps-format-radio-group"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="json"
                      id="stepsFormat-json"
                      data-testid="export-steps-json"
                    />
                    <Label
                      htmlFor="stepsFormat-json"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.textLongFormat.json")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="plainText"
                      id="stepsFormat-plainText"
                      data-testid="export-steps-plainText"
                    />
                    <Label
                      htmlFor="stepsFormat-plainText"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.textLongFormat.plainText")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Row Mode */}
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <Label
                  htmlFor="rowMode"
                  className="text-right whitespace-nowrap shrink-0 flex items-center"
                >
                  {t("rowMode.label")}
                  <HelpPopover helpKey="exportModal.rowMode" />
                </Label>
                <RadioGroup
                  id="rowMode"
                  value={rowMode}
                  onValueChange={(value: "single" | "multi") =>
                    setRowMode(value)
                  }
                  className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
                  data-testid="export-row-mode-radio-group"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="single"
                      id="rowMode-single"
                      data-testid="export-rowMode-single"
                    />
                    <Label htmlFor="rowMode-single" className="cursor-pointer">
                      {tGlobal("repository.exportModal.rowMode.single")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="multi"
                      id="rowMode-multi"
                      data-testid="export-rowMode-multi"
                    />
                    <Label htmlFor="rowMode-multi" className="cursor-pointer">
                      {t("rowMode.multi")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Attachment Format */}
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <Label
                  htmlFor="attachmentFormat"
                  className="text-right whitespace-nowrap shrink-0 flex items-center"
                >
                  {tGlobal("repository.exportModal.attachmentFormat.label")}
                  <HelpPopover helpKey="exportModal.attachmentFormat" />
                </Label>
                <RadioGroup
                  id="attachmentFormat"
                  value={attachmentFormat}
                  onValueChange={(value: "json" | "names") =>
                    setAttachmentFormat(value)
                  }
                  className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
                  data-testid="export-attachment-format-radio-group"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="json"
                      id="attachmentFormat-json"
                      data-testid="export-attachment-json"
                    />
                    <Label
                      htmlFor="attachmentFormat-json"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.textLongFormat.json")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="names"
                      id="attachmentFormat-names"
                      data-testid="export-attachment-names"
                    />
                    <Label
                      htmlFor="attachmentFormat-names"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.attachmentFormat.names")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </>
          )}
          {/* PDF Specific Options */}
          {format === "pdf" && (
            <>
              {/* Export Columns for PDF */}
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <Label
                  htmlFor="columns-pdf"
                  className="text-right whitespace-nowrap shrink-0 flex items-center"
                >
                  {tGlobal("common.table.columns.columns")}
                  <HelpPopover helpKey="exportModal.columns" />
                </Label>
                <RadioGroup
                  id="columns-pdf"
                  value={columns}
                  onValueChange={(value: "visible" | "all") => setColumns(value)}
                  className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
                  data-testid="export-columns-pdf-radio-group"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="all"
                      id="columns-pdf-all"
                      data-testid="export-columns-pdf-all"
                    />
                    <Label htmlFor="columns-pdf-all" className="cursor-pointer">
                      {tGlobal("repository.exportModal.columns.all")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="visible"
                      id="columns-pdf-visible"
                      data-testid="export-columns-pdf-visible"
                    />
                    <Label
                      htmlFor="columns-pdf-visible"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.columns.visible")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Attachment Format for PDF */}
              <div className="flex justify-between items-center gap-4 flex-wrap">
                <Label
                  htmlFor="attachmentFormat-pdf"
                  className="text-right whitespace-nowrap shrink-0 flex items-center"
                >
                  {tGlobal("repository.exportModal.attachmentFormat.label")}
                  <HelpPopover helpKey="exportModal.attachmentFormat" />
                </Label>
                <RadioGroup
                  id="attachmentFormat-pdf"
                  value={attachmentFormat}
                  onValueChange={(value: "json" | "names" | "embedded") =>
                    setAttachmentFormat(value)
                  }
                  className="flex flex-row flex-wrap gap-x-4 gap-y-1 justify-end"
                  data-testid="export-attachment-format-pdf-radio-group"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="names"
                      id="attachmentFormat-pdf-names"
                      data-testid="export-attachment-pdf-names"
                    />
                    <Label
                      htmlFor="attachmentFormat-pdf-names"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.attachmentFormat.names")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="embedded"
                      id="attachmentFormat-pdf-embedded"
                      data-testid="export-attachment-pdf-embedded"
                    />
                    <Label
                      htmlFor="attachmentFormat-pdf-embedded"
                      className="cursor-pointer"
                    >
                      {tGlobal("repository.exportModal.attachmentFormat.embedded")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            {tGlobal("common.cancel")}
          </Button>
          <Button
            onClick={handleExportClick}
            disabled={
              isExporting ||
              (scope === "selected" && !canExportSelected)
            }
            data-testid="export-modal-export-button"
          >
            {isExporting ? tGlobal("repository.exportModal.exporting") : tGlobal("repository.cases.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
