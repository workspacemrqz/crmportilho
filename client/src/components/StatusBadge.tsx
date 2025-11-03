import { Badge } from "@/components/ui/badge";

export type LeadStatus = "new" | "inProgress" | "waitingDocs" | "completed" | "transferred";

interface StatusBadgeProps {
  status: LeadStatus;
}

const statusConfig = {
  new: { label: "Novo", className: "bg-status-new text-white" },
  inProgress: { label: "Em Atendimento", className: "bg-status-inProgress text-white" },
  waitingDocs: { label: "Aguardando Docs", className: "bg-status-waitingDocs text-white" },
  completed: { label: "Concluído", className: "bg-status-completed text-white" },
  transferred: { label: "Transferido", className: "bg-status-transferred text-white" },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge className={config.className} data-testid={`badge-status-${status}`}>
      {config.label}
    </Badge>
  );
}
