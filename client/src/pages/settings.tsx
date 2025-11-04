import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2, Save, RotateCcw, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const settingsSchema = z.object({
  bufferTimeoutSeconds: z.coerce.number().min(1).max(300)
});

type SettingsForm = z.infer<typeof settingsSchema>;

type Settings = {
  id: string;
  bufferTimeoutSeconds: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// WhatsApp section removida

export default function SettingsPage() {
  const { toast } = useToast();
  const [isBufferSectionOpen, setIsBufferSectionOpen] = useState(false);

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  // Conexão do WhatsApp removida

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      bufferTimeoutSeconds: settings?.bufferTimeoutSeconds || 30
    },
    values: settings ? {
      bufferTimeoutSeconds: settings.bufferTimeoutSeconds
    } : undefined
  });

  const updateMutation = useMutation({
    mutationFn: async (data: SettingsForm) => {
      return apiRequest("PUT", "/api/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Configurações salvas!",
        description: "As alterações foram aplicadas com sucesso."
      });
    },
    onError: () => {
      toast({
        title: "Erro ao salvar",
        description: "Não foi possível salvar as configurações.",
        variant: "destructive"
      });
    }
  });

  // Mutations da conexão WhatsApp removidas

  const onSubmit = (data: SettingsForm) => {
    updateMutation.mutate(data);
  };

  const resetToDefault = () => {
    form.setValue("bufferTimeoutSeconds", 30);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-4 sm:p-6 max-w-4xl">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">Configurações do Sistema</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-2">
            Ajuste as configurações globais do chatbot e sistema CRM
          </p>
        </div>

        <Collapsible open={isBufferSectionOpen} onOpenChange={setIsBufferSectionOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className={`cursor-pointer hover-elevate active-elevate-2 rounded-t-xl ${!isBufferSectionOpen ? 'rounded-b-xl' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <CardTitle className="text-lg" style={{ color: '#E76030' }}>Buffer de Mensagens</CardTitle>
                    <CardDescription className="text-xs">
                      Tempo de espera de mensagens
                    </CardDescription>
                  </div>
                  <ChevronDown 
                    className={`h-5 w-5 transition-transform duration-200 ${isBufferSectionOpen ? 'rotate-180' : ''}`}
                    data-testid="icon-chevron-buffer"
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField
                      control={form.control}
                      name="bufferTimeoutSeconds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tempo de Espera (segundos)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              max={300}
                              {...field}
                              data-testid="input-buffer-timeout"
                              className="max-w-xs"
                            />
                          </FormControl>
                          <FormDescription>
                            Recomendado: 15-60 segundos
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        type="submit"
                        disabled={updateMutation.isPending}
                        data-testid="button-save-settings"
                      >
                        {updateMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          <>
                            <Save className="mr-2 h-4 w-4" />
                            Salvar Configurações
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Seção 'Conexão do WhatsApp' removida */}
      </div>
    </div>
  );
}
