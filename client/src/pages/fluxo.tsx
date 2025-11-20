import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Trash2, Save, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

type FlowConfig = {
  id?: string;
  welcomeMessage: string;
  institutionalMessage: string;
  importantInstructions: string;
  globalPrompt: string;
  isActive?: boolean;
};

type KeywordRule = {
  id?: string;
  keyword: string;
  response: string;
  isActive?: boolean;
};

type FlowStep = {
  id?: string;
  stepId: string;
  stepName: string;
  objective: string;
  stepPrompt: string;
  routingInstructions: string;
  order: number;
  exampleMessage?: string;
};

type AIPreviewResponse = {
  mensagemAgente: string;
  proximaEtapaId: string | null;
};

const DEFAULT_WELCOME_MESSAGE = `A Prevline Seguros, agradece o contato.

✅Trabalhamos com 15 Melhores Seguradoras.Ex: Porto Seguro, Azul, Allianz, HDI,Bradesco, etc.

⚠Seguro é perfil de cliente não conseguimos dar preço sem análise de questionário de risco.

👨‍👩‍👧‍👦 Nossa equipe é referência há mais de 15 anos.Consulte nossa avaliação no Google.`;

const DEFAULT_INSTITUTIONAL_MESSAGE = `🚨 IMPORTANTE 🚨
📌 Gentileza enviar sua solicitação por escrito.
❗ Não ouvimos áudio no WhatsApp! 🔇
❌ Não atendemos ligações pelo WhatsApp!

Vamos começar seu atendimento.`;

const DEFAULT_IMPORTANT_INSTRUCTIONS = `Instruções importantes:
- Sempre responda de forma cordial e profissional
- Não ofereça preços sem análise completa
- Solicite todos os dados necessários antes de enviar o formulário
- Use o formulário online: https://prevlineseguros.aggilizador.com.br`;

const DEFAULT_GLOBAL_PROMPT = `Você é o IAGO, assistente digital da Prevline Seguros, uma corretora de seguros com mais de 15 anos de experiência.

Tom de voz: cordial, profissional e objetivo.

Objetivo principal: Conduzir o lead até o preenchimento completo do formulário de cotação online.

Regras gerais:
- Sempre seja educado e paciente
- Colete informações de forma progressiva, sem pressionar
- Não ofereça preços sem análise completa do perfil de risco
- Explique que trabalhamos com as 15 melhores seguradoras do mercado
- Sempre siga as etapas definidas no fluxo
- Use as instruções de roteamento em linguagem natural para decidir a próxima etapa`;

const DEFAULT_STEPS: FlowStep[] = [
  {
    stepId: "identificacao_inicial",
    stepName: "Identificação Inicial",
    objective: "Identificar se o lead já é cliente ou se é uma nova cotação",
    stepPrompt: "Cumprimente o lead de forma cordial. Pergunte se já é cliente da Prevline ou se deseja fazer uma nova cotação.",
    routingInstructions: "Se o lead disser que já é cliente, siga para a etapa 'atendimento_cliente'. Se disser que quer fazer uma nova cotação, siga para a etapa 'tipo_seguro'.",
    order: 0,
    exampleMessage: "Oi, boa tarde"
  },
  {
    stepId: "tipo_seguro",
    stepName: "Tipo de Seguro",
    objective: "Identificar qual tipo de seguro o lead deseja (auto, residencial, etc)",
    stepPrompt: "Pergunte qual tipo de seguro o lead deseja contratar. Mencione as opções: seguro de carro, seguro residencial ou outro tipo de seguro.",
    routingInstructions: "Se o lead mencionar 'carro' ou 'auto', siga para a etapa 'detalhes_auto'. Se mencionar 'residencial' ou 'casa', siga para a etapa 'detalhes_residencial'. Para outros tipos, siga para 'encaminhamento_especialista'.",
    order: 1,
    exampleMessage: "Quero um seguro"
  },
  {
    stepId: "detalhes_auto",
    stepName: "Detalhes do Seguro Auto",
    objective: "Coletar informações básicas sobre o seguro de veículo",
    stepPrompt: "Faça perguntas sobre: se o veículo já possui seguro ativo, se é usado para apps de transporte (Uber, 99), e colete dados básicos do veículo.",
    routingInstructions: "Após coletar as informações básicas e confirmar que não é para uso em apps de transporte, siga para a etapa 'envio_formulario'. Se for para uso em apps, siga para 'produto_nao_disponivel'.",
    order: 2,
    exampleMessage: "É para meu carro"
  },
  {
    stepId: "envio_formulario",
    stepName: "Envio do Formulário",
    objective: "Enviar o link do formulário de cotação para o lead preencher",
    stepPrompt: "Explique que para fazer uma cotação precisa, precisamos que ele preencha um formulário online rápido. Envie o link: https://prevlineseguros.aggilizador.com.br",
    routingInstructions: "Após enviar o formulário, siga para a etapa 'aguardando_preenchimento'. Se o lead recusar, siga para 'tratamento_objecao'.",
    order: 3,
    exampleMessage: "Sim, pode enviar"
  },
  {
    stepId: "aguardando_preenchimento",
    stepName: "Aguardando Preenchimento",
    objective: "Confirmar que o lead recebeu o formulário e orientar sobre o preenchimento",
    stepPrompt: "Confirme que o lead recebeu o link e peça para avisar quando preencher. Ofereça ajuda caso o link não esteja abrindo.",
    routingInstructions: "Se o lead disser que preencheu, siga para 'confirmacao_dados'. Se disser que o link não abre, envie o link específico para auto: https://prevlineseguros.aggilizador.com.br/auto. Se não responder ou demorar, mantenha na mesma etapa.",
    order: 4,
    exampleMessage: "O link não está abrindo"
  }
];

export default function FluxoPage() {
  const { toast } = useToast();
  
  const [config, setConfig] = useState<FlowConfig>({
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    institutionalMessage: DEFAULT_INSTITUTIONAL_MESSAGE,
    importantInstructions: DEFAULT_IMPORTANT_INSTRUCTIONS,
    globalPrompt: DEFAULT_GLOBAL_PROMPT
  });

  const [keywords, setKeywords] = useState<KeywordRule[]>([
    { keyword: "oi", response: "Olá! Como posso ajudá-lo hoje?" },
    { keyword: "bom dia", response: "Bom dia! Seja bem-vindo à Prevline Seguros." },
    { keyword: "link", response: "Aqui está o link do formulário: https://prevlineseguros.aggilizador.com.br" }
  ]);

  const [steps, setSteps] = useState<FlowStep[]>(DEFAULT_STEPS);
  const [previewResults, setPreviewResults] = useState<Map<string, AIPreviewResponse>>(new Map());

  const { data: activeFlow, isLoading: loadingActive } = useQuery<any>({
    queryKey: ['/api/flows/active'],
    retry: false
  });

  useEffect(() => {
    if (activeFlow) {
      setConfig({
        id: activeFlow.id,
        welcomeMessage: activeFlow.welcomeMessage,
        institutionalMessage: activeFlow.institutionalMessage,
        importantInstructions: activeFlow.importantInstructions,
        globalPrompt: activeFlow.globalPrompt,
        isActive: activeFlow.isActive
      });
      
      if (activeFlow.keywords && activeFlow.keywords.length > 0) {
        setKeywords(activeFlow.keywords);
      }
      
      if (activeFlow.steps && activeFlow.steps.length > 0) {
        setSteps(activeFlow.steps.sort((a: FlowStep, b: FlowStep) => a.order - b.order));
      }
    }
  }, [activeFlow]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (config.id) {
        return apiRequest("PUT", `/api/flows/${config.id}`, {
          ...config,
          keywords: keywords.map((k, index) => ({ ...k, isActive: true })),
          steps: steps.map((s, index) => ({ ...s, order: index, isActive: true }))
        });
      } else {
        const newFlow: any = await apiRequest("POST", "/api/flows", {
          ...config,
          isActive: true,
          keywords: keywords.map((k) => ({ ...k, isActive: true })),
          steps: steps.map((s, index) => ({ ...s, order: index, isActive: true }))
        });
        
        if (newFlow.id) {
          await apiRequest("POST", `/api/flows/${newFlow.id}/activate`, {});
        }
        
        return newFlow;
      }
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/flows/active'] });
      setConfig(prev => ({ ...prev, id: data.id }));
      toast({
        title: "Fluxo salvo!",
        description: "As configurações do fluxo foram salvas com sucesso."
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao salvar",
        description: error.message || "Não foi possível salvar o fluxo.",
        variant: "destructive"
      });
    }
  });

  const previewMutation = useMutation({
    mutationFn: async ({ step, message }: { step: FlowStep; message: string }): Promise<AIPreviewResponse> => {
      return apiRequest("POST", "/api/ia/preview", {
        promptGlobal: config.globalPrompt,
        etapaAtual: {
          id: step.stepId,
          nome: step.stepName,
          objetivo: step.objective,
          promptEtapa: step.stepPrompt,
          instrucoesRoteamento: step.routingInstructions
        },
        etapasDefinidas: steps.map(s => ({ id: s.stepId, nome: s.stepName })),
        historicoConversaExemplo: [],
        mensagemClienteExemplo: message
      }) as unknown as Promise<AIPreviewResponse>;
    },
    onSuccess: (data, variables) => {
      setPreviewResults(prev => new Map(prev.set(variables.step.stepId, data)));
      toast({
        title: "Resposta gerada!",
        description: "A IA gerou uma resposta de exemplo para esta etapa."
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao gerar resposta",
        description: error.message || "Não foi possível gerar a resposta da IA.",
        variant: "destructive"
      });
    }
  });

  const addKeyword = () => {
    setKeywords([...keywords, { keyword: "", response: "" }]);
  };

  const removeKeyword = (index: number) => {
    setKeywords(keywords.filter((_, i) => i !== index));
  };

  const updateKeyword = (index: number, field: keyof KeywordRule, value: string) => {
    const updated = [...keywords];
    updated[index] = { ...updated[index], [field]: value };
    setKeywords(updated);
  };

  const addStep = () => {
    setSteps([...steps, {
      stepId: `etapa_${steps.length + 1}`,
      stepName: `Nova Etapa ${steps.length + 1}`,
      objective: "",
      stepPrompt: "",
      routingInstructions: "",
      order: steps.length,
      exampleMessage: ""
    }]);
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, field: keyof FlowStep, value: string | number) => {
    const updated = [...steps];
    updated[index] = { ...updated[index], [field]: value };
    setSteps(updated);
  };

  const generatePreview = (step: FlowStep) => {
    if (!step.exampleMessage || step.exampleMessage.trim() === "") {
      toast({
        title: "Mensagem necessária",
        description: "Digite uma mensagem de exemplo do cliente para testar.",
        variant: "destructive"
      });
      return;
    }
    previewMutation.mutate({ step, message: step.exampleMessage });
  };

  if (loadingActive) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Fluxo de Atendimento – Prevline Seguros</h1>
          <p className="text-muted-foreground mt-1">
            Configure mensagens, regras e fluxo inteligente com IA para atendimento via WhatsApp
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          size="lg"
          data-testid="button-save-flow"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Salvar Fluxo
            </>
          )}
        </Button>
      </div>

      <Alert>
        <AlertDescription>
          O fluxo entre as etapas é decidido pela IA com base nas instruções em linguagem natural que você escrever. 
          A IA analisa o contexto da conversa e escolhe automaticamente a próxima etapa sem necessidade de programação.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1. Mensagens Padrão</CardTitle>
          <CardDescription>
            Configure as mensagens padrão que serão enviadas automaticamente no início do atendimento
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="welcome-message">Mensagem de Boas-vindas</Label>
            <Textarea
              id="welcome-message"
              value={config.welcomeMessage}
              onChange={(e) => setConfig({ ...config, welcomeMessage: e.target.value })}
              rows={6}
              placeholder="Mensagem de boas-vindas..."
              data-testid="textarea-welcome-message"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="institutional-message">Mensagem Institucional</Label>
            <Textarea
              id="institutional-message"
              value={config.institutionalMessage}
              onChange={(e) => setConfig({ ...config, institutionalMessage: e.target.value })}
              rows={4}
              placeholder="Informações sobre a empresa..."
              data-testid="textarea-institutional-message"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="important-instructions">Instruções Importantes</Label>
            <Textarea
              id="important-instructions"
              value={config.importantInstructions}
              onChange={(e) => setConfig({ ...config, importantInstructions: e.target.value })}
              rows={4}
              placeholder="Instruções importantes para o atendimento..."
              data-testid="textarea-important-instructions"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>2. Regras de Resposta por Palavra-chave</CardTitle>
            <CardDescription>
              Respostas automáticas simples quando o lead mencionar palavras ou frases específicas
            </CardDescription>
          </div>
          <Button onClick={addKeyword} variant="outline" size="sm" data-testid="button-add-keyword">
            <Plus className="w-4 h-4 mr-1" />
            Adicionar Regra
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {keywords.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma regra configurada. Clique em "Adicionar Regra" para começar.
            </p>
          ) : (
            keywords.map((keyword, index) => (
              <div key={index} className="flex gap-4 items-start p-4 border rounded-md">
                <div className="flex-1 space-y-3">
                  <div className="space-y-2">
                    <Label>Palavra-chave do lead</Label>
                    <Input
                      value={keyword.keyword}
                      onChange={(e) => updateKeyword(index, 'keyword', e.target.value)}
                      placeholder='Ex: "oi", "bom dia", "link"'
                      data-testid={`input-keyword-${index}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Resposta automática</Label>
                    <Textarea
                      value={keyword.response}
                      onChange={(e) => updateKeyword(index, 'response', e.target.value)}
                      rows={2}
                      placeholder="Mensagem que será enviada quando o lead usar esta palavra-chave"
                      data-testid={`textarea-keyword-response-${index}`}
                    />
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeKeyword(index)}
                  data-testid={`button-remove-keyword-${index}`}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Fluxo com IA</CardTitle>
          <CardDescription>
            Configure o comportamento global do agente e as etapas do fluxo de atendimento
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="global-prompt">Prompt Global do Agente / Fluxo</Label>
            <Textarea
              id="global-prompt"
              value={config.globalPrompt}
              onChange={(e) => setConfig({ ...config, globalPrompt: e.target.value })}
              rows={8}
              placeholder="Defina o papel, tom de voz e objetivo geral do agente de IA..."
              data-testid="textarea-global-prompt"
            />
            <p className="text-sm text-muted-foreground">
              Este prompt será usado em todas as interações da IA como contexto global
            </p>
          </div>

          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Etapas do Fluxo</h3>
              <Button onClick={addStep} variant="outline" size="sm" data-testid="button-add-step">
                <Plus className="w-4 h-4 mr-1" />
                Adicionar Etapa
              </Button>
            </div>

            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma etapa configurada. Clique em "Adicionar Etapa" para começar.
              </p>
            ) : (
              <div className="space-y-6">
                {steps.map((step, index) => (
                  <Card key={index} className="border-2">
                    <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Etapa {index + 1}</Badge>
                          <CardTitle className="text-base">{step.stepName}</CardTitle>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeStep(index)}
                        data-testid={`button-remove-step-${index}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>ID da Etapa</Label>
                          <Input
                            value={step.stepId}
                            onChange={(e) => updateStep(index, 'stepId', e.target.value)}
                            placeholder="exemplo_01"
                            data-testid={`input-step-id-${index}`}
                          />
                          <p className="text-xs text-muted-foreground">
                            Identificador único (sem espaços)
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label>Nome da Etapa</Label>
                          <Input
                            value={step.stepName}
                            onChange={(e) => updateStep(index, 'stepName', e.target.value)}
                            placeholder="Nome amigável"
                            data-testid={`input-step-name-${index}`}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Objetivo da Etapa</Label>
                        <Textarea
                          value={step.objective}
                          onChange={(e) => updateStep(index, 'objective', e.target.value)}
                          rows={2}
                          placeholder="O que essa etapa deve alcançar?"
                          data-testid={`textarea-step-objective-${index}`}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Prompt da Etapa</Label>
                        <Textarea
                          value={step.stepPrompt}
                          onChange={(e) => updateStep(index, 'stepPrompt', e.target.value)}
                          rows={3}
                          placeholder="Como o agente deve se comportar nesta etapa? Que perguntas fazer?"
                          data-testid={`textarea-step-prompt-${index}`}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Instruções de Roteamento (Linguagem Natural)</Label>
                        <Textarea
                          value={step.routingInstructions}
                          onChange={(e) => updateStep(index, 'routingInstructions', e.target.value)}
                          rows={3}
                          placeholder='Ex: "Siga para a etapa identificacao_inicial se o cliente demonstrar interesse. Siga para encerramento se recusar."'
                          data-testid={`textarea-step-routing-${index}`}
                        />
                        <p className="text-xs text-muted-foreground">
                          A IA usará estas instruções para decidir qual etapa seguir
                        </p>
                      </div>

                      <div className="border-t pt-4 space-y-3">
                        <Label>Testar com IA</Label>
                        <div className="flex gap-2">
                          <Input
                            value={step.exampleMessage || ""}
                            onChange={(e) => updateStep(index, 'exampleMessage', e.target.value)}
                            placeholder="Digite uma mensagem de exemplo do cliente..."
                            data-testid={`input-step-example-${index}`}
                          />
                          <Button
                            onClick={() => generatePreview(step)}
                            disabled={previewMutation.isPending}
                            variant="secondary"
                            data-testid={`button-generate-preview-${index}`}
                          >
                            {previewMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                          </Button>
                        </div>

                        {previewResults.has(step.stepId) && (
                          <div className="bg-muted/50 p-4 rounded-md space-y-2">
                            <p className="text-sm font-semibold">Resposta de exemplo da IA:</p>
                            <p className="text-sm">{previewResults.get(step.stepId)?.mensagemAgente}</p>
                            <div className="flex items-center gap-2 mt-3">
                              <p className="text-sm font-semibold">Próxima etapa sugerida:</p>
                              <Badge>
                                {previewResults.get(step.stepId)?.proximaEtapaId || "Encerrar fluxo"}
                              </Badge>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resumo do Fluxo</CardTitle>
          <CardDescription>
            Visualização compacta da configuração atual
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Prompt Global</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded-md">
              {config.globalPrompt.substring(0, 200)}
              {config.globalPrompt.length > 200 ? '...' : ''}
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-2">Etapas Configuradas ({steps.length})</h4>
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div key={index} className="text-sm p-3 bg-muted/30 rounded-md">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs">
                      {step.stepId}
                    </Badge>
                    <span className="font-medium">{step.stepName}</span>
                  </div>
                  <p className="text-muted-foreground text-xs">{step.objective}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-2">Regras de Palavra-chave ({keywords.length})</h4>
            <div className="grid grid-cols-2 gap-2">
              {keywords.map((keyword, index) => (
                <div key={index} className="text-sm p-2 bg-muted/30 rounded-md">
                  <span className="font-medium">{keyword.keyword}</span> → {keyword.response.substring(0, 30)}...
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
