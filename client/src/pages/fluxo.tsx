import { useState, useEffect, useRef, useCallback } from "react";
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
  stepType?: 'ai' | 'fixed';
  buffer?: number;
  exampleMessage?: string;
  position?: { x: number; y: number } | any;
  transitions?: any[];
};

type AIPreviewResponse = {
  mensagemAgente: string;
  proximaEtapaId: string | null;
};

const DEFAULT_WELCOME_MESSAGE = `A Prevline Seguros, agradece o contato. 

✅Trabalhamos com 15 Melhores Seguradoras.Ex: Porto Seguro, Azul, Allianz, HDI,Bradesco, etc.

⚠Seguro é perfil de cliente não conseguimos dar preço sem análise de questionário de risco.

👨‍👩‍👧‍👦 Nossa equipe é referência há mais de 15 anos.Consulte nossa avaliação no Google.

🚨 IMPORTANTE 🚨
📌 Gentileza enviar sua solicitação por escrito.
❗ Não ouvimos áudio no WhatsApp! 🔇
❌ Não atendemos ligações pelo WhatsApp!

Vamos começar seu atendimento. 😀`;

const DEFAULT_INSTITUTIONAL_MESSAGE = `Oi, Gabriel! Tudo ótimo por aqui, e com você? Sou o IAGO, assistente do Daniel na Prevline Seguros. Você já é cliente da Prevline ou deseja fazer uma nova cotação?`;

const DEFAULT_IMPORTANT_INSTRUCTIONS = `Instruções importantes:
- Sempre responda de forma cordial e profissional
- Não ofereça preços sem análise completa
- Solicite todos os dados necessários antes de enviar o formulário
- Encaminhe para formulário de cotação online da empresa`;

const DEFAULT_GLOBAL_PROMPT = `Você é o IAGO, assistente digital do Daniel na Prevline Seguros, uma empresa com mais de 15 anos de experiência no mercado.

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
    stepPrompt: "Aguarde a resposta do cliente sobre se ele já é cliente da Prevline ou se deseja fazer uma nova cotação. Não envie mensagens adicionais, apenas aguarde.",
    routingInstructions: "Se o lead disser que já é cliente, siga para a etapa 'atendimento_cliente'. Se disser que quer fazer uma nova cotação, siga para a etapa 'tipo_seguro'.",
    stepType: "ai",
    buffer: 0,
    order: 0,
    exampleMessage: "Quero fazer uma cotação"
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const initialLoadRef = useRef(true);

  const { data: activeFlow, isLoading: loadingActive } = useQuery<any>({
    queryKey: ['/api/flows/active'],
    retry: false
  });

  useEffect(() => {
    if (activeFlow) {
      console.log('[FluxoPage] useEffect activeFlow - carregando dados do banco:', {
        stepsCount: activeFlow.steps?.length || 0,
        stepIds: activeFlow.steps?.map((s: FlowStep) => s.stepId) || [],
        hasUnsavedChanges,
        initialLoad: initialLoadRef.current
      });
      
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
      
      // CRÍTICO: Só sobrescreve steps se NÃO houver mudanças não salvas
      // Isso previne que o React Query refetch sobrescreva mudanças locais (ex: nodes deletados)
      if (activeFlow.steps !== undefined && !hasUnsavedChanges) {
        const loadedSteps = activeFlow.steps.length > 0 
          ? activeFlow.steps.sort((a: FlowStep, b: FlowStep) => a.order - b.order)
          : [];
        
        console.log('[FluxoPage] useEffect activeFlow - setando steps com:', loadedSteps.length, 'nodes');
        setSteps(loadedSteps);
        initialLoadRef.current = false;
      } else if (hasUnsavedChanges) {
        console.log('[FluxoPage] useEffect activeFlow - BLOQUEADO: não sobrescreve porque há mudanças não salvas');
      }
    }
  }, [activeFlow, hasUnsavedChanges]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      console.log('[FluxoPage] saveMutation - salvando com steps:', steps.length, steps.map(s => s.stepId));
      
      if (config.id) {
        const payload = {
          ...config,
          keywords: keywords.map((k, index) => ({ ...k, isActive: true })),
          steps: steps.map((s, index) => ({ ...s, order: index, isActive: true }))
        };
        console.log('[FluxoPage] saveMutation - enviando PUT com payload:', payload);
        return apiRequest("PUT", `/api/flows/${config.id}`, payload);
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
      console.log('[FluxoPage] saveMutation - sucesso! Limpando flag hasUnsavedChanges');
      setHasUnsavedChanges(false); // Limpa flag de mudanças não salvas
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

  // Wrapper para setSteps que marca mudanças não salvas
  const handleStepsChange = useCallback((newStepsOrUpdater: FlowStep[] | ((prev: FlowStep[]) => FlowStep[])) => {
    console.log('[FluxoPage] handleStepsChange CHAMADO - marcando hasUnsavedChanges = true');
    console.log('[FluxoPage] handleStepsChange - tipo:', typeof newStepsOrUpdater);
    
    setSteps((prevSteps) => {
      const newSteps = typeof newStepsOrUpdater === 'function' 
        ? newStepsOrUpdater(prevSteps) 
        : newStepsOrUpdater;
      
      console.log('[FluxoPage] handleStepsChange - ANTES:', prevSteps.length, 'steps:', prevSteps.map(s => s.stepId));
      console.log('[FluxoPage] handleStepsChange - DEPOIS:', newSteps.length, 'steps:', newSteps.map(s => s.stepId));
      
      setHasUnsavedChanges(true);
      return newSteps;
    });
  }, []);

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
          onStepsChange={handleStepsChange}
          onNodeSelect={handleNodeSelect}
          selectedNodeId={selectedNodeId}
          onSave={() => saveMutation.mutate()}
          isSaving={saveMutation.isPending}
        />
        
        <NodeEditPanel
          selectedNode={selectedNode}
          allSteps={steps}
          onNodeUpdate={handleNodeUpdate}
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
