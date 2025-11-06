import { FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileAttachmentProps {
  fileName: string;
  fileSize?: number;
  fileUrl?: string;
  isBot: boolean;
}

export default function FileAttachment({ fileName, fileSize, fileUrl, isBot }: FileAttachmentProps) {
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleClick = () => {
    if (fileUrl) {
      window.open(fileUrl, '_blank');
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:opacity-80 transition-opacity max-w-xs",
        isBot
          ? "bg-primary text-primary-foreground border-primary/20"
          : "bg-muted border-muted-foreground/20"
      )}
      onClick={handleClick}
    >
      <div className={cn(
        "flex-shrink-0 p-2 rounded-md",
        isBot ? "bg-primary-foreground/20" : "bg-muted-foreground/10"
      )}>
        <FileText className={cn(
          "h-6 w-6",
          isBot ? "text-primary-foreground" : "text-muted-foreground"
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {fileName}
        </p>
        {fileSize && (
          <p className={cn(
            "text-xs",
            isBot ? "text-primary-foreground/80" : "text-muted-foreground"
          )}>
            {formatFileSize(fileSize)}
          </p>
        )}
      </div>
      {fileUrl && (
        <Download className={cn(
          "h-4 w-4 flex-shrink-0",
          isBot ? "text-primary-foreground" : "text-muted-foreground"
        )} />
      )}
    </div>
  );
}
