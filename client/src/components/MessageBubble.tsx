import { cn } from "@/lib/utils";
import MediaBubble from "./MediaBubble";

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
  const hasMedia = (isImage || isDocument) && metadata?.fileUrl;
  
  return (
    <div
      className={cn(
        "flex flex-col gap-1 max-w-2xl",
        isBot ? "items-end ml-auto" : "items-start"
      )}
      data-testid={isBot ? "message-bot" : "message-user"}
    >
      {hasMedia ? (
        <MediaBubble
          type={isImage ? 'image' : 'document'}
          mediaUrl={metadata.fileUrl!}
          caption={content}
          filename={metadata.filename}
          fileSize={metadata.size}
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
