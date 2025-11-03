import { Badge } from "@/components/ui/badge";
import { AlertCircle, ArrowUp, Minus, ArrowDown } from "lucide-react";

export type Priority = "urgent" | "high" | "normal" | "low";

interface PriorityBadgeProps {
  priority: Priority;
}

const priorityConfig = {
  urgent: { 
    label: "Urgente", 
    className: "bg-priority-urgent text-white",
    icon: AlertCircle 
  },
  high: { 
    label: "Alta", 
    className: "bg-priority-high text-white",
    icon: ArrowUp 
  },
  normal: { 
    label: "Normal", 
    className: "bg-priority-normal text-white",
    icon: Minus 
  },
  low: { 
    label: "Baixa", 
    className: "bg-priority-low text-white",
    icon: ArrowDown 
  },
};

export default function PriorityBadge({ priority }: PriorityBadgeProps) {
  const config = priorityConfig[priority];
  const Icon = config.icon;
  
  return (
    <Badge className={`${config.className} gap-1`} data-testid={`badge-priority-${priority}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
