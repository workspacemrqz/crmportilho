import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  contactName: string;
  contactPhone: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  isActive?: boolean;
}

interface ConversationListProps {
  conversations: Conversation[];
  onSelect?: (id: string) => void;
}

export default function ConversationList({ conversations, onSelect }: ConversationListProps) {
  return (
    <div className="flex flex-col">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          className={cn(
            "p-4 border-b cursor-pointer hover-elevate active-elevate-2",
            conv.isActive && "border-l-2 border-foreground/20 bg-muted/30"
          )}
          onClick={() => {
            onSelect?.(conv.id);
            console.log(`Conversation ${conv.id} selected`);
          }}
          data-testid={`conversation-${conv.id}`}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold truncate text-[hsl(var(--primary))]" data-testid={`text-conv-name-${conv.id}`}>
                {conv.contactName}
              </h4>
              <p className="text-xs text-muted-foreground truncate">
                {conv.contactPhone}
              </p>
            </div>
            {conv.unread > 0 && (
              <Badge 
                variant="default" 
                className="bg-primary text-primary-foreground h-5 min-w-5 px-1.5 text-xs flex-shrink-0"
                data-testid={`badge-unread-${conv.id}`}
              >
                {conv.unread}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate mb-1">
            {conv.lastMessage}
          </p>
          <span className="text-xs text-muted-foreground">{conv.timestamp}</span>
        </div>
      ))}
    </div>
  );
}
