import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Sparkles, Loader2, X, RefreshCw } from 'lucide-react';
import { StepTransition } from '@shared/schema';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type FlowStep = {
  id?: string;
  stepId: string;
  stepName: string;
  objective: string;
  stepPrompt: string;
  routingInstructions: string;
  order: number;
  exampleMessage?: string;
  position?: { x: number; y: number } | any;
  transitions?: StepTransition[] | any;
  buffer?: number;
  stepType?: 'ai' | 'fixed';
  changeStatusTo?: string | null;
  changePriorityTo?: string | null;
};

type NodeEditPanelProps = {
  selectedNode: FlowStep | null;
  allSteps: FlowStep[];
  onNodeUpdate: (updatedNode: FlowStep) => void;
  onRegenerateStepId: (oldStepId: string, newTitle: string) => void;
  onTestWithAI: (step: FlowStep) => void;
  isTestingAI: boolean;
  aiPreviewResult?: {
    mensagemAgente: string;
    proximaEtapaId: string | null;
  } | null;
  onClose?: () => void;
};

export default function NodeEditPanel({
  selectedNode,
  allSteps,
  onNodeUpdate,
  onRegenerateStepId,
  onTestWithAI,
  isTestingAI,
  aiPreviewResult,
  onClose,
}: NodeEditPanelProps) {
  const [editedNode, setEditedNode] = useState<FlowStep | null>(null);
  const [fixedMessages, setFixedMessages] = useState<string[]>([]);

  useEffect(() => {
    if (selectedNode) {
      const node = { ...selectedNode };
      setEditedNode(node);
    } else {
      setEditedNode(null);
      setFixedMessages([]);
    }
  }, [selectedNode]);

  useEffect(() => {
    if (!editedNode) return;

    if (editedNode.stepType === 'fixed') {
      // Parse mensagens para nodes Fixed
      let messages: string[] = [];
      try {
        const parsed = JSON.parse(editedNode.stepPrompt || '[]');
        if (Array.isArray(parsed)) {
          // Preservar array exatamente como armazenado - permitir strings vazias durante edição
          messages = parsed;
        }
      } catch {
        messages = editedNode.stepPrompt ? [editedNode.stepPrompt] : [''];
      }
      
      if (messages.length === 0) {
        messages = [''];
      }
      
      setFixedMessages(messages);
      
    } else if (editedNode.stepType === 'ai') {
      // Para nodes AI, converter JSON array para string se necessário
      setFixedMessages([]);
      
      // NÃO MUTAR: criar nova cópia
      let promptString = editedNode.stepPrompt || '';
      try {
        const parsed = JSON.parse(editedNode.stepPrompt || '');
        if (Array.isArray(parsed)) {
          promptString = parsed[0] || '';
          
          // Criar CÓPIA imutável e atualizar via onNodeUpdate
          const updatedNode = {
            ...editedNode,
            stepPrompt: promptString
          };
          
          // Chamar onNodeUpdate para propagar mudança corretamente
          onNodeUpdate(updatedNode);
          setEditedNode(updatedNode);
          return; // Evitar re-render duplo
        }
      } catch {
        // Já é string, tudo ok
      }
    }
  }, [editedNode?.stepType, editedNode?.stepPrompt]);

  const handleClose = () => {
    setEditedNode(null);
    onClose?.();
  };

  if (!editedNode || !selectedNode) {
    return null;
  }

  const updateField = (field: keyof FlowStep, value: any) => {
    const updated = { ...editedNode, [field]: value };
    setEditedNode(updated);
    onNodeUpdate(updated);
  };

  const transitions = Array.isArray(editedNode.transitions) ? editedNode.transitions : [];

  const addTransition = () => {
    const newTransition: StepTransition = {
      id: `transition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      label: '',
      targetStepId: '',
    };
    
    const updatedTransitions = [...transitions, newTransition];
    updateField('transitions', updatedTransitions);
  };

  const updateTransition = (index: number, field: keyof StepTransition, value: string) => {
    const updatedTransitions = transitions.map((t, i) =>
      i === index ? { ...t, [field]: value } : t
    );
    updateField('transitions', updatedTransitions);
  };

  const removeTransition = (index: number) => {
    const updatedTransitions = transitions.filter((_, i) => i !== index);
    updateField('transitions', updatedTransitions);
  };

  const handleTestAI = () => {
    console.log('[NodeEditPanel] handleTestAI called');
    console.log('[NodeEditPanel] editedNode:', editedNode);
    
    if (!editedNode.exampleMessage || editedNode.exampleMessage.trim() === '') {
      alert('Digite uma mensagem de exemplo para testar com a IA');
      return;
    }
    
    console.log('[NodeEditPanel] Calling onTestWithAI with:', editedNode);
    onTestWithAI(editedNode);
  };

  const addFixedMessage = () => {
    // Only for fixed type nodes
    if (editedNode.stepType !== 'fixed') {
      console.error('[NodeEditPanel] Attempted to add fixed message to non-fixed node');
      return;
    }
    
    const newMessages = [...fixedMessages, ''];
    setFixedMessages(newMessages);
    // JSON.stringify ONLY for fixed nodes
    updateField('stepPrompt', JSON.stringify(newMessages));
  };

  const updateFixedMessage = (index: number, value: string) => {
    // Only for fixed type nodes
    if (editedNode.stepType !== 'fixed') {
      console.error('[NodeEditPanel] Attempted to update fixed message on non-fixed node');
      return;
    }
    
    const newMessages = [...fixedMessages];
    newMessages[index] = value;
    setFixedMessages(newMessages);
    // JSON.stringify ONLY for fixed nodes
    updateField('stepPrompt', JSON.stringify(newMessages));
  };

  const removeFixedMessage = (index: number) => {
    // Only for fixed type nodes
    if (editedNode.stepType !== 'fixed') {
      console.error('[NodeEditPanel] Attempted to remove fixed message from non-fixed node');
      return;
    }
    
    if (fixedMessages.length <= 1) {
      alert('Deve haver pelo menos uma mensagem');
      return;
    }
    const newMessages = fixedMessages.filter((_, i) => i !== index);
    setFixedMessages(newMessages);
    // JSON.stringify ONLY for fixed nodes
    updateField('stepPrompt', JSON.stringify(newMessages));
  };

  const availableTargets = allSteps.filter(s => s.stepId !== editedNode.stepId);
  const isFixedType = editedNode.stepType === 'fixed';
  const isAiType = !isFixedType;

  return (
    <Dialog open={!!selectedNode} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <DialogTitle>Editar Etapa: {editedNode.stepName}</DialogTitle>
            <Badge 
              variant={isFixedType ? "default" : "secondary"}
              className={isFixedType ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"}
              data-testid="badge-step-type"
            >
              {isFixedType ? "Mensagem Fixa" : "Mensagem com IA"}
            </Badge>
          </div>
          <DialogDescription>
            Configure os detalhes desta etapa
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="step-name">Nome da Etapa</Label>
            <Input
              id="step-name"
              value={editedNode.stepName}
              onChange={(e) => updateField('stepName', e.target.value)}
              placeholder="Ex: Identificação Inicial"
              data-testid="input-edit-step-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="step-id" className="flex items-center justify-between">
              <span>ID da Etapa</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRegenerateStepId(editedNode.stepId, editedNode.stepName)}
                className="h-6 text-xs"
                data-testid="button-regenerate-step-id"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Gerar novo ID
              </Button>
            </Label>
            <Input
              id="step-id"
              value={editedNode.stepId}
              disabled
              className="bg-muted"
              data-testid="input-edit-step-id"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="objective">Objetivo</Label>
            <Textarea
              id="objective"
              value={editedNode.objective}
              onChange={(e) => updateField('objective', e.target.value)}
              rows={2}
              placeholder="O que essa etapa deve alcançar?"
              data-testid="textarea-edit-objective"
            />
          </div>

          {isFixedType ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Mensagens Fixas</Label>
                <Button
                  onClick={addFixedMessage}
                  size="sm"
                  variant="outline"
                  data-testid="button-add-fixed-message"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Adicionar Mensagem
                </Button>
              </div>
              
              <div className="space-y-3">
                {fixedMessages.map((message, index) => (
                  <Card key={index} className="p-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">Mensagem {index + 1}</Label>
                        {fixedMessages.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFixedMessage(index)}
                            className="h-6"
                            data-testid={`button-remove-fixed-message-${index}`}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <Textarea
                        value={message}
                        onChange={(e) => updateFixedMessage(index, e.target.value)}
                        rows={3}
                        placeholder="Digite a mensagem..."
                        data-testid={`input-fixed-message-${index}`}
                      />
                    </div>
                  </Card>
                ))}
              </div>
              
              <p className="text-xs text-muted-foreground">
                As mensagens serão enviadas sequencialmente com intervalo de 2-4 segundos.
                <br />
                Tags disponíveis: <code className="px-1 py-0.5 rounded bg-muted">{"{nome}"}</code> (primeiro nome), <code className="px-1 py-0.5 rounded bg-muted">[DD/MM/AAAA]</code> (data atual), <code className="px-1 py-0.5 rounded bg-muted">[NÚMERO_DO_PROTOCOLO]</code> (protocolo do cliente)
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="step-prompt">Prompt</Label>
                <Textarea
                  id="step-prompt"
                  value={editedNode.stepPrompt}
                  onChange={(e) => updateField('stepPrompt', e.target.value)}
                  rows={4}
                  placeholder="Como o agente deve se comportar? Que perguntas fazer?"
                  data-testid="textarea-edit-prompt"
                />
                <p className="text-xs text-muted-foreground">
                  Tags disponíveis: <code className="px-1 py-0.5 rounded bg-muted">{"{nome}"}</code> (primeiro nome), <code className="px-1 py-0.5 rounded bg-muted">[DD/MM/AAAA]</code> (data atual), <code className="px-1 py-0.5 rounded bg-muted">[NÚMERO_DO_PROTOCOLO]</code> (protocolo do cliente)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="routing">Instruções de Roteamento</Label>
                <Textarea
                  id="routing"
                  value={editedNode.routingInstructions}
                  onChange={(e) => updateField('routingInstructions', e.target.value)}
                  rows={3}
                  placeholder="Como a IA deve decidir o próximo passo"
                  data-testid="textarea-edit-routing"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="buffer">Buffer (segundos)</Label>
            <Input
              id="buffer"
              type="number"
              value={editedNode.buffer ?? 30}
              onChange={(e) => updateField('buffer', Number(e.target.value))}
              placeholder="30"
              min="1"
              max="300"
              data-testid="input-buffer"
            />
            <p className="text-xs text-muted-foreground">
              Tempo para coletar mensagens antes de responder
            </p>
          </div>

          <div className="border-t pt-4 space-y-4">
            <Label className="text-sm font-semibold">Mudança Automática de Tags</Label>
            <p className="text-xs text-muted-foreground">
              Configure se o lead deve ter seu status ou prioridade alterados ao chegar nesta etapa
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="change-status">Mudar Status Para</Label>
                <Select
                  value={(editedNode as any).changeStatusTo || 'sem_mudanca'}
                  onValueChange={(value) => updateField('changeStatusTo', value === 'sem_mudanca' ? null : value)}
                >
                  <SelectTrigger id="change-status" data-testid="select-change-status">
                    <SelectValue placeholder="Manter atual" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sem_mudanca">Não alterar</SelectItem>
                    <SelectItem value="novo">Novo</SelectItem>
                    <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                    <SelectItem value="aguardando_documentos">Aguardando Documentos</SelectItem>
                    <SelectItem value="encaminhado">Encaminhado</SelectItem>
                    <SelectItem value="transferido_humano">Transferido para Humano</SelectItem>
                    <SelectItem value="concluido">Concluído</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="change-priority">Mudar Prioridade Para</Label>
                <Select
                  value={(editedNode as any).changePriorityTo || 'sem_mudanca'}
                  onValueChange={(value) => updateField('changePriorityTo', value === 'sem_mudanca' ? null : value)}
                >
                  <SelectTrigger id="change-priority" data-testid="select-change-priority">
                    <SelectValue placeholder="Manter atual" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sem_mudanca">Não alterar</SelectItem>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm font-semibold">Transições</Label>
              <Button
                onClick={addTransition}
                size="sm"
                variant="outline"
                data-testid="button-add-transition"
              >
                <Plus className="w-3 h-3 mr-1" />
                Adicionar
              </Button>
            </div>

            {transitions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 border rounded-md">
                Nenhuma transição configurada. Arraste uma conexão no canvas ou clique em "Adicionar".
              </p>
            ) : (
              <div className="space-y-3">
                {transitions.map((transition, index) => (
                  <Card key={transition.id} className="p-3">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-xs">Rótulo da Transição</Label>
                        <Input
                          value={transition.label}
                          onChange={(e) => updateTransition(index, 'label', e.target.value)}
                          placeholder='Ex: "já é cliente", "nova cotação"'
                          className="text-sm"
                          data-testid={`input-transition-label-${index}`}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Etapa de Destino</Label>
                        <Select
                          value={transition.targetStepId}
                          onValueChange={(value) => updateTransition(index, 'targetStepId', value)}
                        >
                          <SelectTrigger className="text-sm" data-testid={`select-transition-target-${index}`}>
                            <SelectValue placeholder="Selecione a etapa" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableTargets.map((step) => (
                              <SelectItem key={step.stepId} value={step.stepId}>
                                {step.stepName} ({step.stepId})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTransition(index)}
                        className="w-full"
                        data-testid={`button-remove-transition-${index}`}
                      >
                        <Trash2 className="w-3 h-3 mr-1 text-destructive" />
                        <span className="text-xs">Remover Transição</span>
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {isAiType && (
            <div className="border-t pt-6">
              <Label className="text-sm font-semibold mb-3 block">Testar com IA</Label>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs">Mensagem de Exemplo do Cliente</Label>
                  <Textarea
                    value={editedNode.exampleMessage || ''}
                    onChange={(e) => updateField('exampleMessage', e.target.value)}
                    rows={2}
                    placeholder="Digite uma mensagem de exemplo do cliente..."
                    data-testid="textarea-example-message"
                  />
                </div>

                <Button
                  onClick={handleTestAI}
                  disabled={isTestingAI}
                  variant="outline"
                  className="w-full"
                  data-testid="button-test-ai"
                >
                  {isTestingAI ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Gerando resposta...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Testar Resposta
                    </>
                  )}
                </Button>

                {aiPreviewResult && (
                  <Card className="p-3 bg-muted/30">
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">Resposta da IA:</Label>
                        <p className="text-sm mt-1">{aiPreviewResult.mensagemAgente}</p>
                      </div>
                      {aiPreviewResult.proximaEtapaId && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Próxima Etapa:</Label>
                          <Badge variant="outline" className="mt-1 text-xs">
                            {aiPreviewResult.proximaEtapaId}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
