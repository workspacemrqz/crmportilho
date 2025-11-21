import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Trash2, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import FlowEditor, { generateStepId, type FlowEditorRef } from "@/components/FlowEditor";
import NodeEditPanel from "@/components/NodeEditPanel";

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

const DEFAULT_WELCOME_MESSAGE = `A Seguro IA agradece o contato.

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
- Encaminhe para formulário de cotação online da empresa`;

const DEFAULT_GLOBAL_PROMPT = `Você é um assistente digital da Seguro IA, uma plataforma de seguros com experiência no mercado.

Tom de voz: cordial, profissional e objetivo.

Objetivo principal: Conduzir o lead até o preenchimento completo do formulário de cotação online.

Regras gerais:
- Sempre seja educado e paciente
- Colete informações de forma progressiva, sem pressionar
- Não ofereça preços sem análise completa do perfil de risco
- Explique que trabalhamos com as melhores seguradoras do mercado
- Sempre siga as etapas definidas no fluxo
- Use as instruções de roteamento em linguagem natural para decidir a próxima etapa`;

const DEFAULT_STEPS: FlowStep[] = [
  {
    stepId: "identificacao_inicial",
    stepName: "Identificação Inicial",
    objective: "Identificar se o lead já é cliente ou se é uma nova cotação",
    stepPrompt: "Cumprimente o lead de forma cordial. Pergunte se já é cliente da Seguro IA ou se deseja fazer uma nova cotação.",
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
    stepPrompt: "Explique que para fazer uma cotação precisa, precisamos que ele preencha um formulário online rápido. Envie o link do formulário de cotação.",
    routingInstructions: "Após enviar o formulário, siga para a etapa 'aguardando_preenchimento'. Se o lead recusar, siga para 'tratamento_objecao'.",
    order: 3,
    exampleMessage: "Sim, pode enviar"
  },
  {
    stepId: "aguardando_preenchimento",
    stepName: "Aguardando Preenchimento",
    objective: "Confirmar que o lead recebeu o formulário e orientar sobre o preenchimento",
    stepPrompt: "Confirme que o lead recebeu o link e peça para avisar quando preencher. Ofereça ajuda caso o link não esteja abrindo.",
    routingInstructions: "Se o lead disser que preencheu, siga para 'confirmacao_dados'. Se disser que o link não abre, tente novamente enviando o link do formulário. Se não responder ou demorar, mantenha na mesma etapa.",
    order: 4,
    exampleMessage: "O link não está abrindo"
  }
];

export default function FluxoPage() {
  const { toast } = useToast();
  const flowEditorRef = useRef<FlowEditorRef>(null);
  
  const [config, setConfig] = useState<FlowConfig>({
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    institutionalMessage: DEFAULT_INSTITUTIONAL_MESSAGE,
    importantInstructions: DEFAULT_IMPORTANT_INSTRUCTIONS,
    globalPrompt: DEFAULT_GLOBAL_PROMPT
  });

  const [keywords, setKeywords] = useState<KeywordRule[]>([
    { keyword: "oi", response: "Olá! Como posso ajudá-lo hoje?" },
    { keyword: "bom dia", response: "Bom dia! Seja bem-vindo à Seguro IA." },
    { keyword: "link", response: "Aqui está o link do formulário de cotação." }
  ]);

  const [steps, setSteps] = useState<FlowStep[]>(DEFAULT_STEPS);
  const [previewResults, setPreviewResults] = useState<Map<string, AIPreviewResponse>>(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
      console.log('[FluxoPage] previewMutation called with:', { step, message });
      console.log('[FluxoPage] config.globalPrompt:', config.globalPrompt);
      
      const requestData = {
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
      };
      
      console.log('[FluxoPage] Sending request to /api/ia/preview with data:', requestData);
      
      const res = await apiRequest("POST", "/api/ia/preview", requestData);
      const response = await res.json() as AIPreviewResponse;
      
      console.log('[FluxoPage] Received response:', response);
      return response;
    },
    onSuccess: (data, variables) => {
      console.log('[FluxoPage] Preview mutation success:', data);
      setPreviewResults(prev => new Map(prev.set(variables.step.stepId, data)));
      toast({
        title: "Resposta gerada!",
        description: "A IA gerou uma resposta de exemplo para esta etapa."
      });
    },
    onError: (error: any) => {
      console.error('[FluxoPage] Preview mutation error:', error);
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

  const handleNodeUpdate = (updatedNode: FlowStep) => {
    const updatedSteps = steps.map((step) =>
      step.stepId === updatedNode.stepId ? updatedNode : step
    );
    setSteps(updatedSteps);
  };

  const handleNodeDelete = (stepId: string) => {
    const updatedSteps = steps.filter((step) => step.stepId !== stepId);
    setSteps(updatedSteps);
    setSelectedNodeId(null);
  };

  const handleRegenerateStepId = (oldStepId: string, newTitle: string) => {
    // Encontrar o step que será atualizado
    const stepToUpdate = steps.find(s => s.stepId === oldStepId);
    if (!stepToUpdate) {
      toast({
        title: "Erro",
        description: "Etapa não encontrada.",
        variant: "destructive"
      });
      return;
    }

    // Gerar novo ID baseado no título
    const existingIds = steps
      .filter(s => s.stepId !== oldStepId)
      .map(s => s.stepId);
    
    const newStepId = generateStepId(newTitle, existingIds);

    // Se o ID não mudou, não fazer nada
    if (newStepId === oldStepId) {
      toast({
        title: "ID não alterado",
        description: "O ID gerado é o mesmo que o atual.",
      });
      return;
    }

    // Atualizar todos os steps de forma coordenada
    const updatedSteps = steps.map(step => {
      // Atualizar o stepId do step específico
      if (step.stepId === oldStepId) {
        // IMPORTANTE: Também atualizar self-referential transitions
        // (transitions dentro do próprio step que apontam para ele mesmo)
        const updatedTransitions = step.transitions && Array.isArray(step.transitions)
          ? step.transitions.map(t =>
              t.targetStepId === oldStepId
                ? { ...t, targetStepId: newStepId }
                : t
            )
          : step.transitions;
        
        return { ...step, stepId: newStepId, transitions: updatedTransitions };
      }

      // Atualizar transitions que apontam para o ID antigo (em outros steps)
      if (step.transitions && Array.isArray(step.transitions)) {
        const hasTransitionToOldId = step.transitions.some(
          t => t.targetStepId === oldStepId
        );

        if (hasTransitionToOldId) {
          return {
            ...step,
            transitions: step.transitions.map(t =>
              t.targetStepId === oldStepId
                ? { ...t, targetStepId: newStepId }
                : t
            )
          };
        }
      }

      return step;
    });

    // PRIMEIRO: Migrar caches e React Flow state via método imperativo
    // Isso deve acontecer ANTES de atualizar o state para evitar flickering
    // Passar updatedSteps para reconstruir edges imediatamente
    flowEditorRef.current?.applyStepIdRename({ oldId: oldStepId, newId: newStepId }, updatedSteps);

    // SEGUNDO: Migrar previewResults Map
    if (previewResults.has(oldStepId)) {
      const oldPreview = previewResults.get(oldStepId);
      const newPreviewResults = new Map(previewResults);
      newPreviewResults.delete(oldStepId);
      if (oldPreview) {
        newPreviewResults.set(newStepId, oldPreview);
      }
      setPreviewResults(newPreviewResults);
    }

    // TERCEIRO: Atualizar states
    setSteps(updatedSteps);

    // QUARTO: Atualizar selectedNodeId se necessário
    if (selectedNodeId === oldStepId) {
      setSelectedNodeId(newStepId);
    }

    // QUINTO: Feedback ao usuário
    toast({
      title: "ID atualizado",
      description: `ID alterado de "${oldStepId}" para "${newStepId}". Todas as conexões foram atualizadas.`,
    });
  };

  const handleNodeSelect = (step: FlowStep | null) => {
    setSelectedNodeId(step?.stepId || null);
  };

  const selectedNode = selectedNodeId ? steps.find((s) => s.stepId === selectedNodeId) || null : null;

  if (loadingActive) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full">
      <div className="flex-1 overflow-hidden p-4">
        <FlowEditor
          ref={flowEditorRef}
          steps={steps}
          onStepsChange={setSteps}
          onNodeSelect={handleNodeSelect}
          selectedNodeId={selectedNodeId}
          onSave={() => saveMutation.mutate()}
          isSaving={saveMutation.isPending}
        />
        
        <NodeEditPanel
          selectedNode={selectedNode}
          allSteps={steps}
          onNodeUpdate={handleNodeUpdate}
          onNodeDelete={handleNodeDelete}
          onRegenerateStepId={handleRegenerateStepId}
          onTestWithAI={(step) => {
            if (!step.exampleMessage || step.exampleMessage.trim() === "") {
              toast({
                title: "Mensagem necessária",
                description: "Digite uma mensagem de exemplo do cliente para testar.",
                variant: "destructive"
              });
              return;
            }
            previewMutation.mutate({ step, message: step.exampleMessage });
          }}
          isTestingAI={previewMutation.isPending}
          aiPreviewResult={selectedNode && previewResults.has(selectedNode.stepId) 
            ? previewResults.get(selectedNode.stepId) 
            : null}
          onClose={() => setSelectedNodeId(null)}
        />
      </div>
    </div>
  );
}
