import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, Plus, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

interface WahaConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceName: string;
  initialWebhooks?: string[];
}


export function WahaConfigDialog({
  open,
  onOpenChange,
  instanceName,
  initialWebhooks = [],
}: WahaConfigDialogProps) {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<string[]>(initialWebhooks.length > 0 ? initialWebhooks : [""]);
  const [isSaving, setIsSaving] = useState(false);

  // Reset state when dialog opens or props change
  useEffect(() => {
    if (open) {
      setWebhooks(initialWebhooks.length > 0 ? initialWebhooks : [""]);
    }
  }, [open, initialWebhooks]);

  const handleAddWebhook = () => {
    setWebhooks([...webhooks, ""]);
  };

  const handleRemoveWebhook = (index: number) => {
    const newWebhooks = webhooks.filter((_, i) => i !== index);
    setWebhooks(newWebhooks.length > 0 ? newWebhooks : [""]);
  };

  const handleWebhookChange = (index: number, value: string) => {
    const newWebhooks = [...webhooks];
    newWebhooks[index] = value;
    setWebhooks(newWebhooks);
  };

  const handleSave = async () => {
    setIsSaving(true);
    
    try {
      const filteredWebhooks = webhooks.filter(w => w.trim() !== "");

      await apiRequest("PATCH", `/api/instancias/${instanceName}/waha-config`, {
        webhooks: filteredWebhooks,
      });

      toast({
        title: "Configuração atualizada",
        description: "As configurações WAHA foram atualizadas com sucesso.",
      });

      queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating WAHA config:", error);
      toast({
        title: "Erro ao atualizar",
        description: "Não foi possível atualizar as configurações WAHA.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Configuração WAHA
          </DialogTitle>
          <DialogDescription>
            Configure webhooks para a instância{" "}
            <strong>{instanceName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-base font-semibold">Webhooks</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddWebhook}
                data-testid="button-add-webhook"
              >
                <Plus className="w-4 h-4 mr-1" />
                Adicionar
              </Button>
            </div>
            <div className="space-y-2">
              {webhooks.map((webhook, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    placeholder="https://exemplo.com/webhook"
                    value={webhook}
                    onChange={(e) => handleWebhookChange(index, e.target.value)}
                    data-testid={`input-webhook-${index}`}
                  />
                  {webhooks.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveWebhook(index)}
                      data-testid={`button-remove-webhook-${index}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            data-testid="button-cancel-config"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            data-testid="button-save-config"
          >
            {isSaving ? "Salvando..." : "Salvar Configuração"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
