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
import { Loader2, Save, RotateCcw, Info, ChevronDown, Smartphone, RefreshCw, Power, LogOut } from "lucide-react";
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

type WhatsAppStatus = {
  status: string;
  qr?: string;
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [isBufferSectionOpen, setIsBufferSectionOpen] = useState(false);
  const [isWhatsAppSectionOpen, setIsWhatsAppSectionOpen] = useState(false);

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { data: whatsappStatus, isLoading: isLoadingWhatsApp, refetch: refetchWhatsApp } = useQuery<WhatsAppStatus>({
    queryKey: ["/api/whatsapp/status"],
    refetchInterval: isWhatsAppSectionOpen ? 3000 : false,
  });

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

  const startSessionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/whatsapp/start");
    },
    onSuccess: () => {
      refetchWhatsApp();
      toast({
        title: "Sessão iniciada!",
        description: "A sessão do WhatsApp foi iniciada. Escaneie o QR code."
      });
    },
    onError: () => {
      toast({
        title: "Erro ao iniciar",
        description: "Não foi possível iniciar a sessão.",
        variant: "destructive"
      });
    }
  });

  const stopSessionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/whatsapp/stop");
    },
    onSuccess: () => {
      refetchWhatsApp();
      toast({
        title: "Sessão parada!",
        description: "A sessão do WhatsApp foi parada."
      });
    },
    onError: () => {
      toast({
        title: "Erro ao parar",
        description: "Não foi possível parar a sessão.",
        variant: "destructive"
      });
    }
  });

  const logoutSessionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/whatsapp/logout");
    },
    onSuccess: () => {
      refetchWhatsApp();
      toast({
        title: "Logout realizado!",
        description: "O WhatsApp foi desconectado com sucesso."
      });
    },
    onError: () => {
      toast({
        title: "Erro ao desconectar",
        description: "Não foi possível desconectar o WhatsApp.",
        variant: "destructive"
      });
    }
  });

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
              <CardHeader className="cursor-pointer hover-elevate active-elevate-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <CardTitle>Buffer de Mensagens do Chatbot</CardTitle>
                    <CardDescription>
                      Tempo de espera antes de processar mensagens do WhatsApp
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

        <Collapsible open={isWhatsAppSectionOpen} onOpenChange={setIsWhatsAppSectionOpen} className="mt-6">
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover-elevate active-elevate-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      <Smartphone className="h-5 w-5" />
                      Conexão do WhatsApp
                    </CardTitle>
                    <CardDescription>
                      Gerencie a conexão do WhatsApp com a instância WAHA
                    </CardDescription>
                  </div>
                  <ChevronDown 
                    className={`h-5 w-5 transition-transform duration-200 ${isWhatsAppSectionOpen ? 'rotate-180' : ''}`}
                    data-testid="icon-chevron-whatsapp"
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                {isLoadingWhatsApp ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin" data-testid="loader-whatsapp" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Status da Conexão</p>
                          <p className="text-sm text-muted-foreground" data-testid="text-whatsapp-status">
                            {whatsappStatus?.status || 'Desconhecido'}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => refetchWhatsApp()}
                          data-testid="button-refresh-status"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>

                      {whatsappStatus?.qr && (
                        <div className="border rounded-md p-4 bg-background">
                          <p className="text-sm font-medium mb-3">Escaneie o QR Code com seu WhatsApp:</p>
                          <div className="flex justify-center bg-white p-4 rounded-md">
                            <img 
                              src={whatsappStatus.qr} 
                              alt="QR Code do WhatsApp" 
                              className="max-w-full h-auto"
                              data-testid="img-qr-code"
                            />
                          </div>
                          <Alert className="mt-4">
                            <Info className="h-4 w-4" />
                            <AlertDescription>
                              Abra o WhatsApp no seu celular, vá em Dispositivos Conectados e escaneie este código.
                            </AlertDescription>
                          </Alert>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => startSessionMutation.mutate()}
                          disabled={startSessionMutation.isPending}
                          data-testid="button-start-session"
                        >
                          {startSessionMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Iniciando...
                            </>
                          ) : (
                            <>
                              <Power className="mr-2 h-4 w-4" />
                              Iniciar Sessão
                            </>
                          )}
                        </Button>

                        <Button
                          variant="secondary"
                          onClick={() => stopSessionMutation.mutate()}
                          disabled={stopSessionMutation.isPending}
                          data-testid="button-stop-session"
                        >
                          {stopSessionMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Parando...
                            </>
                          ) : (
                            <>
                              <Power className="mr-2 h-4 w-4" />
                              Parar Sessão
                            </>
                          )}
                        </Button>

                        <Button
                          variant="destructive"
                          onClick={() => logoutSessionMutation.mutate()}
                          disabled={logoutSessionMutation.isPending}
                          data-testid="button-logout-session"
                        >
                          {logoutSessionMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Desconectando...
                            </>
                          ) : (
                            <>
                              <LogOut className="mr-2 h-4 w-4" />
                              Desconectar WhatsApp
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    </div>
  );
}
