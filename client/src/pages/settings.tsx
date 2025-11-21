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
import { Loader2, Save, RotateCcw, ChevronDown, TestTube } from "lucide-react";
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
  const [isTestSectionOpen, setIsTestSectionOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("+5511999999999");
  const [testResult, setTestResult] = useState<any>(null);

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

  const testBufferMutation = useMutation({
    mutationFn: async (phone: string) => {
      const response = await apiRequest("POST", "/api/test/buffer-flow", { phone });
      return response as any; // API returns buffer debug info
    },
    onSuccess: (data: any) => {
      setTestResult(data);
      toast({
        title: "Teste executado!",
        description: `Buffer encontrado: ${data.bufferSeconds}s (fonte: ${data.bufferSource})`,
      });
    },
    onError: () => {
      toast({
        title: "Erro no teste",
        description: "Não foi possível executar o teste do buffer.",
        variant: "destructive"
      });
    }
  });

  const onSubmit = (data: SettingsForm) => {
    updateMutation.mutate(data);
  };

  const runBufferTest = () => {
    if (!testPhone || testPhone.trim() === '') {
      toast({
        title: "Telefone inválido",
        description: "Por favor, insira um número de telefone válido.",
        variant: "destructive"
      });
      return;
    }
    setTestResult(null);
    testBufferMutation.mutate(testPhone);
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
                    <CardTitle className="text-lg text-primary">Buffer de Mensagens</CardTitle>
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

        {/* Test Buffer Section */}
        <Collapsible open={isTestSectionOpen} onOpenChange={setIsTestSectionOpen} className="mt-4">
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className={`cursor-pointer hover-elevate active-elevate-2 rounded-t-xl ${!isTestSectionOpen ? 'rounded-b-xl' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <CardTitle className="text-lg text-primary">Teste de Buffer por Node</CardTitle>
                    <CardDescription className="text-xs">
                      Valide o buffer configurável por step do fluxo
                    </CardDescription>
                  </div>
                  <ChevronDown 
                    className={`h-5 w-5 transition-transform duration-200 ${isTestSectionOpen ? 'rotate-180' : ''}`}
                    data-testid="icon-chevron-test"
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <Alert>
                  <TestTube className="h-4 w-4" />
                  <AlertDescription>
                    Este endpoint simula o fluxo de mensagem e retorna informações sobre o buffer configurado para o telefone testado.
                  </AlertDescription>
                </Alert>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="test-phone" className="text-sm font-medium">
                      Número de Telefone
                    </label>
                    <Input
                      id="test-phone"
                      type="text"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="+5511999999999"
                      data-testid="input-test-phone"
                      className="max-w-md"
                    />
                    <p className="text-xs text-muted-foreground">
                      Digite um número de telefone para testar o buffer (com código do país)
                    </p>
                  </div>

                  <Button
                    onClick={runBufferTest}
                    disabled={testBufferMutation.isPending}
                    data-testid="button-test-buffer"
                  >
                    {testBufferMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testando...
                      </>
                    ) : (
                      <>
                        <TestTube className="mr-2 h-4 w-4" />
                        Executar Teste
                      </>
                    )}
                  </Button>

                  {testResult && (
                    <div className="mt-4 p-4 bg-muted rounded-md space-y-2" data-testid="test-result">
                      <h4 className="font-semibold text-sm">Resultado do Teste:</h4>
                      <div className="text-xs space-y-1 font-mono">
                        <p><strong>Telefone:</strong> {testResult.phone}</p>
                        <p><strong>Step Atual:</strong> {testResult.currentStepName || testResult.currentStepId || 'N/A'}</p>
                        <p><strong>Buffer (segundos):</strong> <span className="text-primary font-bold">{testResult.bufferSeconds}s</span></p>
                        <p><strong>Buffer (ms):</strong> {testResult.bufferMs}ms</p>
                        <p><strong>Fonte do Buffer:</strong> 
                          <span className={`ml-2 font-bold ${
                            testResult.bufferSource === 'step' ? 'text-green-600 dark:text-green-400' :
                            testResult.bufferSource === 'global' ? 'text-yellow-600 dark:text-yellow-400' :
                            'text-blue-600 dark:text-blue-400'
                          }`}>
                            {testResult.bufferSource}
                          </span>
                        </p>
                        {testResult.leadId && <p><strong>Lead ID:</strong> {testResult.leadId}</p>}
                        {testResult.conversationId && <p><strong>Conversation ID:</strong> {testResult.conversationId}</p>}
                        {testResult.allSteps && testResult.allSteps.length > 0 && (
                          <div className="mt-2">
                            <p className="font-semibold mb-1">Steps do Fluxo Ativo:</p>
                            <ul className="ml-4 space-y-1">
                              {testResult.allSteps.map((step: any) => (
                                <li key={step.stepId} className={step.stepId === testResult.currentStepId ? 'text-primary font-bold' : ''}>
                                  {step.order}. {step.stepName} - Buffer: {step.buffer}s
                                  {step.stepId === testResult.currentStepId && ' ← ATUAL'}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Seção 'Conexão do WhatsApp' removida */}
      </div>
    </div>
  );
}
