import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface FilterPanelProps {
  onClose?: () => void;
}

export default function FilterPanel({ onClose }: FilterPanelProps) {
  const [filters, setFilters] = useState({
    status: {
      new: false,
      inProgress: false,
      waitingDocs: false,
      completed: false,
      transferred: false
    },
    priority: {
      urgent: false,
      high: false,
      normal: false,
      low: false
    }
  });

  const handleStatusChange = (status: keyof typeof filters.status) => {
    setFilters({
      ...filters,
      status: {
        ...filters.status,
        [status]: !filters.status[status]
      }
    });
    console.log(`Status filter toggled: ${status}`);
  };

  const handlePriorityChange = (priority: keyof typeof filters.priority) => {
    setFilters({
      ...filters,
      priority: {
        ...filters.priority,
        [priority]: !filters.priority[priority]
      }
    });
    console.log(`Priority filter toggled: ${priority}`);
  };

  const clearFilters = () => {
    setFilters({
      status: {
        new: false,
        inProgress: false,
        waitingDocs: false,
        completed: false,
        transferred: false
      },
      priority: {
        urgent: false,
        high: false,
        normal: false,
        low: false
      }
    });
    console.log("Filters cleared");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Filtros</h3>
        {onClose && (
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose}
            data-testid="button-close-filters"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <Label className="text-sm font-medium mb-3 block">Status</Label>
          <div className="space-y-2">
            {[
              { key: "new" as const, label: "Novo" },
              { key: "inProgress" as const, label: "Em Atendimento" },
              { key: "waitingDocs" as const, label: "Aguardando Docs" },
              { key: "completed" as const, label: "Concluído" },
              { key: "transferred" as const, label: "Transferido" }
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`status-${key}`}
                  checked={filters.status[key]}
                  onCheckedChange={() => handleStatusChange(key)}
                  data-testid={`checkbox-status-${key}`}
                />
                <Label htmlFor={`status-${key}`} className="text-sm cursor-pointer">
                  {label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-sm font-medium mb-3 block">Prioridade</Label>
          <div className="space-y-2">
            {[
              { key: "urgent" as const, label: "Urgente" },
              { key: "high" as const, label: "Alta" },
              { key: "normal" as const, label: "Normal" },
              { key: "low" as const, label: "Baixa" }
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`priority-${key}`}
                  checked={filters.priority[key]}
                  onCheckedChange={() => handlePriorityChange(key)}
                  data-testid={`checkbox-priority-${key}`}
                />
                <Label htmlFor={`priority-${key}`} className="text-sm cursor-pointer">
                  {label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-sm font-medium mb-2 block">Buscar</Label>
          <Input
            placeholder="Nome, protocolo, CPF..."
            data-testid="input-search"
          />
        </div>
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={clearFilters}
        data-testid="button-clear-filters"
      >
        Limpar Filtros
      </Button>
    </div>
  );
}
