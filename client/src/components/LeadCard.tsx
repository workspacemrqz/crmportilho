import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatusBadge, { type LeadStatus } from "./StatusBadge";
import PriorityBadge, { type Priority } from "./PriorityBadge";
import { MessageCircle, Phone, Mail } from "lucide-react";

interface LeadCardProps {
  id: string;
  name: string;
  protocol: string;
  status: LeadStatus;
  priority: Priority;
  phone?: string;
  email?: string;
  lastMessage: string;
  timestamp: string;
  onClick?: () => void;
}

export default function LeadCard({
  id,
  name,
  protocol,
  status,
  priority,
  phone,
  email,
  lastMessage,
  timestamp,
  onClick
}: LeadCardProps) {
  return (
    <Card 
      className="p-6 hover-elevate active-elevate-2 cursor-pointer"
      onClick={onClick}
      data-testid={`card-lead-${id}`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate" data-testid="text-lead-name">
              {name}
            </h3>
            <p className="text-xs text-muted-foreground" data-testid="text-lead-protocol">
              Protocolo: {protocol}
            </p>
          </div>
          <div className="flex gap-2">
            <StatusBadge status={status} />
            <PriorityBadge priority={priority} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          {phone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4" />
              <span className="truncate" data-testid="text-lead-phone">{phone}</span>
            </div>
          )}
          {email && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span className="truncate" data-testid="text-lead-email">{email}</span>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 text-sm">
          <MessageCircle className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
          <p className="text-muted-foreground line-clamp-2 flex-1">{lastMessage}</p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{timestamp}</span>
          <Button 
            size="sm" 
            onClick={(e) => {
              e.stopPropagation();
              console.log(`Chat with lead ${id}`);
            }}
            data-testid={`button-chat-${id}`}
          >
            Abrir Chat
          </Button>
        </div>
      </div>
    </Card>
  );
}
