import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  content: string;
  isBot: boolean;
  timestamp: string;
}

export default function MessageBubble({ content, isBot, timestamp }: MessageBubbleProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 max-w-2xl",
        isBot ? "items-start" : "items-end ml-auto"
      )}
      data-testid={isBot ? "message-bot" : "message-user"}
    >
      <div
        className={cn(
          "px-4 py-3 rounded-2xl whitespace-pre-wrap text-sm leading-relaxed",
          isBot
            ? "bg-card text-card-foreground rounded-tl-sm"
            : "bg-primary text-primary-foreground rounded-tr-sm"
        )}
      >
        {content}
      </div>
      <span className="text-xs text-muted-foreground px-1">
        {timestamp}
      </span>
    </div>
  );
}
