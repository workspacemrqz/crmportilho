import { cn } from "@/lib/utils";
import { FileText, Download } from "lucide-react";

interface MediaBubbleProps {
  type: 'image' | 'document';
  mediaUrl: string;
  caption?: string;
  filename?: string;
  fileSize?: number;
  isBot: boolean;
}

export default function MediaBubble({ 
  type, 
  mediaUrl, 
  caption, 
  filename,
  fileSize,
  isBot 
}: MediaBubbleProps) {
  
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleMediaClick = () => {
    window.open(mediaUrl, '_blank');
  };

  const hasCaption = caption && caption.trim().length > 0;

  if (type === 'image') {
    return (
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-2xl max-w-sm",
          isBot ? "rounded-tr-sm" : "rounded-tl-sm",
          isBot 
            ? "bg-primary text-primary-foreground" 
            : "bg-card text-card-foreground border"
        )}
      >
        {/* Image */}
        <div 
          className="cursor-pointer hover:opacity-90 transition-opacity"
          onClick={handleMediaClick}
        >
          <img
            src={mediaUrl}
            alt={caption || "Image"}
            className="w-full h-auto object-cover max-h-96"
            loading="lazy"
          />
        </div>
        
        {/* Caption inside the same bubble */}
        {hasCaption && (
          <div className="px-4 py-3">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {caption}
            </p>
          </div>
        )}
      </div>
    );
  }

  // Document with caption
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl max-w-md",
        isBot ? "rounded-tr-sm" : "rounded-tl-sm",
        isBot 
          ? "bg-primary text-primary-foreground" 
          : "bg-card text-card-foreground border"
      )}
    >
      {/* Document Preview */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-black/5 transition-colors"
        onClick={handleMediaClick}
      >
        <div className={cn(
          "flex-shrink-0 p-2 rounded-md",
          isBot ? "bg-primary-foreground/20" : "bg-muted"
        )}>
          <FileText className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {filename || 'Documento'}
          </p>
          {fileSize && (
            <p className={cn(
              "text-xs",
              isBot ? "text-primary-foreground/70" : "text-muted-foreground"
            )}>
              {formatFileSize(fileSize)}
            </p>
          )}
        </div>
        <Download className="h-4 w-4 flex-shrink-0" />
      </div>

      {/* Caption inside the same bubble */}
      {hasCaption && caption !== filename && (
        <div className="px-4 pb-3 pt-1 border-t border-white/10">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {caption}
          </p>
        </div>
      )}
    </div>
  );
}
