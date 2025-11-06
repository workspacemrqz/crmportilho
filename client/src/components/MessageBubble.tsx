import { cn } from "@/lib/utils";
import FileAttachment from "./FileAttachment";
import ImageAttachment from "./ImageAttachment";

interface MessageBubbleProps {
  content: string;
  isBot: boolean;
  timestamp: string;
  messageType?: string;
  metadata?: {
    filename?: string;
    fileUrl?: string;
    size?: number;
  };
}

export default function MessageBubble({ content, isBot, timestamp, messageType, metadata }: MessageBubbleProps) {
  const isDocument = messageType === 'document';
  const isImage = messageType === 'image';
  
  return (
    <div
      className={cn(
        "flex flex-col gap-1 max-w-2xl",
        isBot ? "items-end ml-auto" : "items-start"
      )}
      data-testid={isBot ? "message-bot" : "message-user"}
    >
      {isImage && metadata?.fileUrl ? (
        <ImageAttachment
          imageUrl={metadata.fileUrl}
          caption={content}
          isBot={isBot}
        />
      ) : isDocument && metadata?.filename ? (
        <FileAttachment
          fileName={metadata.filename}
          fileSize={metadata.size}
          fileUrl={metadata.fileUrl}
          isBot={isBot}
        />
      ) : (
        <div
          className={cn(
            "px-4 py-3 rounded-2xl whitespace-pre-wrap text-sm leading-relaxed",
            isBot
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-card text-card-foreground rounded-tl-sm"
          )}
        >
          {content}
        </div>
      )}
      <span className="text-xs text-muted-foreground px-1">
        {timestamp}
      </span>
    </div>
  );
}
