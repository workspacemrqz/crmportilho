import { useCallback, useEffect, useState, useRef, memo, useMemo, forwardRef, useImperativeHandle } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  NodeChange,
  EdgeChange,
  MarkerType,
  ReactFlowProvider,
  Panel,
  Handle,
  Position,
  applyNodeChanges,
  EdgeLabelRenderer,
  BaseEdge,
  EdgeProps,
  getSmoothStepPath,
  useStoreApi,
  OnConnectStart,
  OnConnectEnd,
  ConnectionLineType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { FlowStepNode as FlowStepNodeType, StepTransition } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, AlertCircle, Star, X, Save, Loader2, Copy, Files, Sparkles, MessageSquare, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';

type FlowStep = {
  id?: string;
  stepId: string;
  stepName: string;
  objective: string;
  stepPrompt: string;
  routingInstructions: string;
  order: number;
  stepType?: 'ai' | 'fixed';
  exampleMessage?: string;
  position?: { x: number; y: number } | any;
  transitions?: StepTransition[] | any;
};

type FlowEditorProps = {
  steps: FlowStep[];
  onStepsChange: (steps: FlowStep[] | ((prev: FlowStep[]) => FlowStep[])) => void;
  onNodeSelect: (step: FlowStep | null) => void;
  selectedNodeId: string | null;
  onSave?: () => void;
  isSaving?: boolean;
};

export type FlowEditorRef = {
  applyStepIdRename: (mapping: { oldId: string; newId: string }, updatedSteps: FlowStep[]) => void;
};

// Função para gerar ID slug a partir do nome da etapa
export function generateStepId(stepName: string, existingIds: string[] = []): string {
  // Remover acentos e normalizar
  const normalized = stepName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  
  // Converter para minúsculas e substituir espaços/caracteres especiais por underscores
  let slug = normalized
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, ''); // Remover underscores no início/fim
  
  // Se o slug estiver vazio, usar um padrão
  if (!slug) {
    slug = 'etapa';
  }
  
  // Verificar se já existe e adicionar sufixo numérico se necessário
  let finalSlug = slug;
  let counter = 1;
  while (existingIds.includes(finalSlug)) {
    finalSlug = `${slug}_${counter}`;
    counter++;
  }
  
  return finalSlug;
}

const FlowStepNode = memo(({ data, selected }: any) => {
  const isStart = data.isStart;
  const transitionsCount = data.transitionsCount || 0;
  const stepType = data.stepType || 'ai'; // Default to 'ai' if not specified
  const [isHovered, setIsHovered] = useState(false);
  const { toast } = useToast();
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Determine styles based on stepType
  const isAI = stepType === 'ai';
  const isFixed = stepType === 'fixed';
  
  const bgColorClass = 'bg-[#121212]';
  
  const borderColorClass = 'border-blue-600';
  
  const textColorClass = 'text-gray-100';
  
  const IconComponent = isAI ? Sparkles : MessageSquare;
  const badgeText = isAI ? 'IA' : 'Fixa';
  const badgeColorClass = 'bg-blue-700 dark:bg-blue-800 text-blue-100 dark:text-blue-200';

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 150);
  };

  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(data.stepId);
      toast({
        title: "ID copiado",
        description: `ID "${data.stepId}" copiado para a área de transferência.`,
      });
    } catch (err) {
      toast({
        title: "Erro ao copiar",
        description: "Não foi possível copiar o ID para a área de transferência.",
        variant: "destructive",
      });
    }
  };


  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.onDuplicate) {
      data.onDuplicate(data.stepId);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[CustomNode] handleDelete CLICADO para stepId:', data.stepId);
    console.log('[CustomNode] handleDelete - onDelete existe?', !!data.onDelete);
    if (data.onDelete) {
      console.log('[CustomNode] handleDelete - EXECUTANDO data.onDelete');
      data.onDelete(data.stepId);
      console.log('[CustomNode] handleDelete - data.onDelete EXECUTADO');
    } else {
      console.error('[CustomNode] handleDelete - ERRO: onDelete não está definido!');
    }
  };
  
  return (
    <div 
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Hover action buttons - positioned above the node, each with its own container */}
      <div 
        className="absolute -top-12 right-0 flex items-center gap-1"
        style={{ visibility: isHovered ? 'visible' : 'hidden' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="bg-background rounded-md p-1 shadow-lg border border-border">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 hover-elevate active-elevate-2"
            onClick={handleCopyId}
            title="Copiar ID"
            data-testid={`button-copy-id-${data.stepId}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="bg-background rounded-md p-1 shadow-lg border border-border">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 hover-elevate active-elevate-2"
            onClick={handleDuplicate}
            title="Duplicar etapa"
            data-testid={`button-duplicate-${data.stepId}`}
          >
            <Files className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="bg-background rounded-md p-1 shadow-lg border border-border">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 hover-elevate active-elevate-2"
            onClick={handleDelete}
            title="Excluir etapa"
            data-testid={`button-delete-${data.stepId}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      
      <div 
        className={`px-4 py-3 rounded-md border-2 min-w-[200px] shadow-lg transition-all hover:shadow-xl relative ${bgColorClass} ${
          selected 
            ? 'border-primary ring-2 ring-primary/20' 
            : isStart 
            ? 'border-primary/60'
            : borderColorClass
        }`}
        data-testid={`node-${data.stepId}`}
      >
        {/* Type Badge - Top Right */}
        <div className="absolute -top-2 -right-2">
          <Badge 
            variant="secondary" 
            className={`text-[10px] px-1.5 py-0 h-5 font-semibold ${badgeColorClass}`}
            data-testid={`badge-type-${data.stepId}`}
          >
            {badgeText}
          </Badge>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <IconComponent className="w-4 h-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="font-semibold text-sm">{data.stepName}</div>
            </div>
            {transitionsCount > 0 && (
              <div className="flex items-center gap-1 text-xs text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-full">
                <span>{transitionsCount}</span>
                <span>→</span>
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">ID: {data.stepId}</div>
          {isStart && (
            <div className="text-xs text-primary font-medium flex items-center gap-1">
              <Star className="w-3 h-3 fill-primary" />
              <span>Início do Fluxo</span>
            </div>
          )}
        </div>
        
        {/* Visible handles for visual feedback */}
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!w-4 hover:!h-4 transition-all"
          style={{ left: -6 }}
          title="Conectar de outra etapa para esta"
          data-testid={`handle-target-left-${data.stepId}`}
        />
        
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!w-4 hover:!h-4 transition-all"
          style={{ right: -6 }}
          title="Arrastar para conectar a outra etapa"
          data-testid={`handle-source-right-${data.stepId}`}
        />
      </div>
    </div>
  );
});

const nodeTypes = {
  flowStep: FlowStepNode,
};

// Custom Edge component with delete button
function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const onEdgeClick = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (data?.onDelete) {
      data.onDelete(id);
    }
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <Button
            variant="destructive"
            size="icon"
            className="h-6 w-6 rounded-full shadow-lg hover:scale-110 transition-transform"
            onClick={onEdgeClick}
            data-testid={`button-delete-edge-${id}`}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = {
  custom: CustomEdge,
};

// Função para calcular hash estrutural (ignora transitions e positions)
function getStructuralHash(steps: FlowStep[]): string {
  return steps
    .map(s => `${s.stepId}|${s.stepName}|${s.objective}|${s.stepPrompt}|${s.routingInstructions}|${s.order}|${s.exampleMessage || ''}`)
    .sort()
    .join('::');
}

function FlowEditorInnerComponent(
  { steps, onStepsChange, onNodeSelect, selectedNodeId, onSave, isSaving }: FlowEditorProps,
  ref: React.ForwardedRef<FlowEditorRef>
) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [invalidTransitions, setInvalidTransitions] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);

  // Memoize nodeTypes and edgeTypes to prevent React Flow warnings
  const memoizedNodeTypes = useMemo(() => nodeTypes, []);
  const memoizedEdgeTypes = useMemo(() => edgeTypes, []);

  // PRIMARY state refs - source of truth
  const positionsRef = useRef<Record<string, {x: number, y: number}>>({});
  const nodesMapRef = useRef<Map<string, Node>>(new Map());
  const fitViewOnInitRef = useRef(true);
  
  // Ref para acessar steps atual sem depender dele no effect
  const stepsRef = useRef<FlowStep[]>(steps);
  
  // Hash estrutural para detectar mudanças estruturais (exclui transitions e positions)
  const structuralHash = useMemo(() => getStructuralHash(steps), [steps]);
  
  // Expor método imperativo para migração de IDs
  useImperativeHandle(ref, () => ({
    applyStepIdRename: (mapping: { oldId: string; newId: string }, updatedSteps: FlowStep[]) => {
      const { oldId, newId } = mapping;
      
      // Migrar positionsRef
      const oldPosition = positionsRef.current[oldId];
      if (oldPosition && !positionsRef.current[newId]) {
        positionsRef.current[newId] = oldPosition;
      }
      delete positionsRef.current[oldId];
      
      // Migrar nodesMapRef
      const oldNode = nodesMapRef.current.get(oldId);
      if (oldNode && !nodesMapRef.current.has(newId)) {
        const updatedStep = updatedSteps.find(s => s.stepId === newId);
        nodesMapRef.current.set(newId, {
          ...oldNode,
          id: newId,
          data: { 
            ...oldNode.data, 
            stepId: newId,
            stepType: updatedStep?.stepType || oldNode.data.stepType || 'ai'
          }
        });
      }
      nodesMapRef.current.delete(oldId);
      
      // Atualizar React Flow nodes state IMEDIATAMENTE
      // Usa nodes state atual como fallback se não houver cache
      setNodes(prevNodes => 
        prevNodes.map(node => {
          if (node.id === oldId) {
            const migratedNode = nodesMapRef.current.get(newId);
            const updatedStep = updatedSteps.find(s => s.stepId === newId);
            return migratedNode || {
              ...node,
              id: newId,
              data: { 
                ...node.data, 
                stepId: newId,
                stepType: updatedStep?.stepType || node.data.stepType || 'ai',
                onDuplicate: handleDuplicateNode,
                onDelete: handleDeleteNode,
              }
            };
          }
          return node;
        })
      );
      
      // Atualizar edges IMEDIATAMENTE usando updatedSteps para reconstruir
      // Isso garante que edges refletem os novos IDs sem esperar useEffect
      const newEdges: Edge[] = [];
      const validStepIds = new Set(updatedSteps.map(s => s.stepId));
      
      updatedSteps.forEach((step) => {
        const transitions = Array.isArray(step.transitions) ? step.transitions : [];
        
        transitions.forEach((transition: StepTransition) => {
          const isValid = validStepIds.has(transition.targetStepId);
          
          if (isValid) {
            newEdges.push({
              id: transition.id,
              source: step.stepId,
              target: transition.targetStepId,
              type: 'custom',
              label: transition.label || '',
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 20,
                height: 20,
              },
              data: { onDelete: () => {} }
            });
          }
        });
      });
      
      setEdges(newEdges);
    }
  }), [setNodes, setEdges]);
  
  // Atualizar stepsRef sempre que steps mudar
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    const updatedSteps = steps.map(step => {
      const transitions = Array.isArray(step.transitions) ? step.transitions : [];
      const filteredTransitions = transitions.filter((t: StepTransition) => t.id !== edgeId);
      
      if (filteredTransitions.length !== transitions.length) {
        return { ...step, transitions: filteredTransitions };
      }
      return step;
    });
    
    onStepsChange(updatedSteps);
  }, [steps, onStepsChange]);

  const convertTransitionsToEdges = useCallback((flowSteps: FlowStep[]): Edge[] => {
    const allEdges: Edge[] = [];
    const validStepIds = new Set(flowSteps.map(s => s.stepId));
    const invalidTargets: string[] = [];

    flowSteps.forEach((step) => {
      const transitions = Array.isArray(step.transitions) ? step.transitions : [];
      
      transitions.forEach((transition: StepTransition, index: number) => {
        const isValid = validStepIds.has(transition.targetStepId);
        
        if (!isValid) {
          invalidTargets.push(`${step.stepId} → ${transition.targetStepId}`);
        }

        const targetStep = flowSteps.find(s => s.stepId === transition.targetStepId);

        allEdges.push({
          id: transition.id,
          source: step.stepId,
          target: transition.targetStepId,
          type: 'custom',
          animated: true,
          data: {
            onDelete: handleDeleteEdge,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
            color: isValid ? 'hsl(var(--primary))' : 'hsl(var(--destructive))',
          },
          style: {
            strokeWidth: 2.5,
            stroke: isValid ? 'hsl(var(--primary))' : 'hsl(var(--destructive))',
          },
        });
      });
    });

    setInvalidTransitions(invalidTargets);
    return allEdges;
  }, [handleDeleteEdge]);

  // Main reconciliation effect - usa structuralHash ao invés de steps!
  // Roda APENAS quando estrutura muda (add/remove steps, change names/prompts)
  // NÃO roda quando apenas transitions mudam
  useEffect(() => {
    const changes: NodeChange[] = [];
    const currentSteps = stepsRef.current;
    
    setNodes((currentNodes) => {
      const currentStepIds = new Set(currentSteps.map(s => s.stepId));
      const existingNodeIds = new Set(currentNodes.map(n => n.id));
      
      // 1. Detectar nodes REMOVIDOS
      existingNodeIds.forEach(id => {
        if (!currentStepIds.has(id)) {
          changes.push({ id, type: 'remove' });
          nodesMapRef.current.delete(id);
          delete positionsRef.current[id];
        }
      });
      
      // 2. Detectar nodes NOVOS
      const nodesToAdd: Node[] = [];
      currentSteps.forEach((step, index) => {
        const existingNode = currentNodes.find(n => n.id === step.stepId);
        
        if (!existingNode) {
          const position = positionsRef.current[step.stepId] 
            ?? (step.position?.x !== undefined ? step.position : null)
            ?? { x: 100 + (index % 3) * 300, y: 100 + Math.floor(index / 3) * 200 };
          
          const newNode: Node = {
            id: step.stepId,
            type: 'flowStep',
            position,
            data: {
              stepId: step.stepId,
              stepName: step.stepName,
              stepType: step.stepType || 'ai',
              isStart: index === 0,
              transitionsCount: Array.isArray(step.transitions) ? step.transitions.length : 0,
              onDuplicate: handleDuplicateNode,
              onDelete: handleDeleteNode,
            },
          };
          
          nodesMapRef.current.set(step.stepId, newNode);
          positionsRef.current[step.stepId] = position;
          nodesToAdd.push(newNode);
        }
      });
      
      // 3. Aplicar remoções e adições
      let updated = currentNodes;
      if (changes.length > 0) {
        updated = applyNodeChanges(changes, updated);
      }
      if (nodesToAdd.length > 0) {
        updated = [...updated, ...nodesToAdd];
      }
      
      // 4. Atualizar data dos nodes existentes (EXCETO transitionsCount)
      updated = updated.map(node => {
        const step = currentSteps.find(s => s.stepId === node.id);
        if (!step) return node;
        
        const index = currentSteps.indexOf(step);
        const needsUpdate = 
          node.data.stepName !== step.stepName ||
          node.data.stepType !== (step.stepType || 'ai') ||
          node.data.isStart !== (index === 0);
        
        if (needsUpdate) {
          const updatedNode = {
            ...node,
            data: {
              ...node.data,
              stepName: step.stepName,
              stepType: step.stepType || 'ai',
              isStart: index === 0,
              onDuplicate: handleDuplicateNode,
              onDelete: handleDeleteNode,
            }
          };
          nodesMapRef.current.set(step.stepId, updatedNode);
          return updatedNode;
        }
        
        return node;
      });
      
      return updated;
    });
    
    // Fit view apenas na primeira renderização
    if (fitViewOnInitRef.current && currentSteps.length > 0) {
      fitViewOnInitRef.current = false;
    }
  }, [structuralHash, setNodes]);

  // Edges reconciliation (lightweight - always rebuild)
  useEffect(() => {
    const newEdges = convertTransitionsToEdges(steps);
    setEdges(newEdges);
  }, [steps, convertTransitionsToEdges, setEdges]);
  
  // Effect separado para atualizar APENAS transitionsCount quando transitions mudam
  // Este effect pode ter steps como dependência porque só atualiza data, não recria nodes
  useEffect(() => {
    setNodes((currentNodes) => {
      return currentNodes.map(node => {
        const step = steps.find(s => s.stepId === node.id);
        if (!step) return node;
        
        const newTransitionsCount = Array.isArray(step.transitions) ? step.transitions.length : 0;
        if (node.data.transitionsCount !== newTransitionsCount) {
          return {
            ...node,
            data: {
              ...node.data,
              stepType: step.stepType || 'ai',
              transitionsCount: newTransitionsCount,
              onDuplicate: handleDuplicateNode,
              onDelete: handleDeleteNode,
            }
          };
        }
        return node;
      });
    });
  }, [steps, setNodes]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);
    
    changes.forEach((change) => {
      if (change.type === 'position' && change.position) {
        // Atualizar positionsRef IMEDIATAMENTE
        positionsRef.current[change.id] = change.position;
        
        // Atualizar nodesMapRef
        const node = nodesMapRef.current.get(change.id);
        if (node) {
          nodesMapRef.current.set(change.id, { ...node, position: change.position });
        }
        
        // Persistir para steps quando parar de arrastar
        if (!change.dragging) {
          onStepsChange((currentSteps: FlowStep[]) => {
            return currentSteps.map((step) =>
              step.stepId === change.id
                ? { ...step, position: change.position }
                : step
            );
          });
        }
      }
      
      // Ignore node removal to prevent accidental deletions
      // Users must use the visual editor controls instead
      if (change.type === 'remove') {
        // Do nothing - node deletion is disabled
        return;
      }
    });
  }, [onStepsChange, onNodesChange]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes);
    
    changes.forEach((change) => {
      if (change.type === 'remove') {
        const updatedSteps = steps.map((step) => {
          const transitions = Array.isArray(step.transitions) ? step.transitions : [];
          return {
            ...step,
            transitions: transitions.filter((t: StepTransition) => t.id !== change.id),
          };
        });
        onStepsChange(updatedSteps);
      }
    });
  }, [onEdgesChange, steps, onStepsChange]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;

    // Guard: Prevent self-connections
    if (connection.source === connection.target) {
      return;
    }

    // Encontra as etapas de origem e destino
    const sourceStep = steps.find(s => s.stepId === connection.source);
    const targetStep = steps.find(s => s.stepId === connection.target);
    
    if (!sourceStep || !targetStep) return;

    // Guard: Prevent duplicate connections
    const existingTransitions = Array.isArray(sourceStep.transitions) ? sourceStep.transitions : [];
    const alreadyConnected = existingTransitions.some(t => t.targetStepId === connection.target);
    
    if (alreadyConnected) {
      return;
    }

    // Cria nova transição
    const newTransition: StepTransition = {
      id: `transition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      label: `→ ${targetStep.stepName}`,
      targetStepId: connection.target,
    };

    // Adicionar transition SEM tocar em positions - Posições preservadas no positionsRef
    const updatedSteps = steps.map((step) => {
      if (step.stepId === connection.source) {
        const transitions = Array.isArray(step.transitions) ? step.transitions : [];
        return {
          ...step,
          transitions: [...transitions, newTransition],
        };
      }
      return step;
    });

    onStepsChange(updatedSteps);
  }, [steps, onStepsChange]);

  const onConnectStart: OnConnectStart = useCallback(() => {
    setIsConnecting(true);
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback(() => {
    setIsConnecting(false);
  }, []);

  const handleNodeDoubleClick = useCallback((_event: any, node: Node) => {
    const step = steps.find(s => s.stepId === node.id);
    onNodeSelect(step || null);
  }, [steps, onNodeSelect]);

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  const addNodeLockRef = useRef(false);
  const lastAddNodeTimeRef = useRef(0);

  const handleAddNode = useCallback((stepType: 'ai' | 'fixed' = 'ai') => {
    const now = Date.now();
    
    // Previne múltiplas execuções simultâneas (evita duplicação de nodes)
    // Implementa debounce de 300ms para garantir que só uma execução aconteça
    if (addNodeLockRef.current || (now - lastAddNodeTimeRef.current) < 300) {
      console.log('[FlowEditor] handleAddNode bloqueado - tentativa de duplicação prevenida');
      return;
    }
    
    addNodeLockRef.current = true;
    lastAddNodeTimeRef.current = now;
    
    console.log('[FlowEditor] handleAddNode - criando novo node', { stepType });
    
    onStepsChange((currentSteps: FlowStep[]) => {
      const stepName = stepType === 'ai' ? 'Nova Etapa IA' : 'Nova Mensagem Fixa';
      const existingIds = currentSteps.map(s => s.stepId);
      const newStepId = generateStepId(stepName, existingIds);
      
      // Verificação extra: se o ID gerado já existe (não deveria, mas por segurança)
      if (existingIds.includes(newStepId)) {
        console.error('[FlowEditor] handleAddNode - ERRO: stepId duplicado detectado:', newStepId);
        addNodeLockRef.current = false;
        return currentSteps; // Não adiciona nada
      }
      
      console.log('[FlowEditor] handleAddNode - novo stepId gerado:', newStepId);
      
      const newStep: FlowStep = {
        stepId: newStepId,
        stepName,
        objective: stepType === 'ai' ? '' : 'Enviar mensagem fixa ao cliente',
        stepPrompt: stepType === 'ai' ? '' : '',
        routingInstructions: stepType === 'ai' ? '' : '',
        stepType,
        order: currentSteps.length,
        position: { 
          x: 100 + (currentSteps.length % 3) * 300, 
          y: 100 + Math.floor(currentSteps.length / 3) * 200 
        },
        transitions: [],
        exampleMessage: '',
      };

      // Libera o lock após um intervalo seguro
      setTimeout(() => {
        addNodeLockRef.current = false;
        console.log('[FlowEditor] handleAddNode - lock liberado');
      }, 300);

      return [...currentSteps, newStep];
    });
  }, [onStepsChange]);

  const handleDuplicateNode = useCallback((stepId: string) => {
    onStepsChange((currentSteps: FlowStep[]) => {
      const stepToDuplicate = currentSteps.find(s => s.stepId === stepId);
      if (!stepToDuplicate) return currentSteps;

      const existingIds = currentSteps.map(s => s.stepId);
      const newStepName = `${stepToDuplicate.stepName} (cópia)`;
      const newStepId = generateStepId(newStepName, existingIds);
      
      const duplicatedStep: FlowStep = {
        ...stepToDuplicate,
        stepId: newStepId,
        stepName: newStepName,
        order: currentSteps.length,
        position: stepToDuplicate.position 
          ? { 
              x: stepToDuplicate.position.x + 50, 
              y: stepToDuplicate.position.y + 50 
            }
          : { 
              x: 100 + (currentSteps.length % 3) * 300, 
              y: 100 + Math.floor(currentSteps.length / 3) * 200 
            },
        transitions: [], // Não duplicar as transições
      };

      return [...currentSteps, duplicatedStep];
    });
  }, [onStepsChange]);

  const handleDeleteNode = useCallback((stepId: string) => {
    console.log('[FlowEditor] handleDeleteNode chamado para stepId:', stepId);
    
    onStepsChange((currentSteps: FlowStep[]) => {
      console.log('[FlowEditor] handleDeleteNode - steps antes da remoção:', currentSteps.length, currentSteps.map(s => s.stepId));
      
      // Remove o node
      const updatedSteps = currentSteps.filter(s => s.stepId !== stepId);
      
      console.log('[FlowEditor] handleDeleteNode - steps após remoção:', updatedSteps.length, updatedSteps.map(s => s.stepId));
      
      // Remove transições que apontam para o node deletado
      const finalSteps = updatedSteps.map(step => ({
        ...step,
        transitions: Array.isArray(step.transitions) 
          ? step.transitions.filter((t: StepTransition) => t.targetStepId !== stepId)
          : []
      }));
      
      console.log('[FlowEditor] handleDeleteNode - retornando steps finais:', finalSteps.length);
      return finalSteps;
    });
    
    // Desselecionar se o node deletado estava selecionado
    onNodeSelect(null);
  }, [onStepsChange, onNodeSelect]);

  return (
    <div className="w-full h-full border rounded-md bg-background relative">
      {invalidTransitions.length > 0 && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 max-w-md">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Conexões inválidas detectadas: {invalidTransitions.join(', ')}
            </AlertDescription>
          </Alert>
        </div>
      )}
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        nodeTypes={memoizedNodeTypes}
        edgeTypes={memoizedEdgeTypes}
        fitView={fitViewOnInitRef.current}
        preventScrolling={true}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'custom',
          animated: false,
        }}
        connectionLineStyle={{
          strokeWidth: 2.5,
          stroke: 'hsl(var(--primary))',
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <Panel position="top-left">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleAddNode('ai')}
              size="sm"
              variant="outline"
              className="bg-card shadow-md"
              data-testid="button-add-ai-step"
            >
              <Sparkles className="w-4 h-4 mr-1" />
              Mensagem com IA
            </Button>
            <Button
              onClick={() => handleAddNode('fixed')}
              size="sm"
              variant="outline"
              className="bg-card shadow-md"
              data-testid="button-add-fixed-step"
            >
              <MessageSquare className="w-4 h-4 mr-1" />
              Mensagem fixa
            </Button>
          </div>
        </Panel>
        {onSave && (
          <Panel position="top-right">
            <Button
              onClick={onSave}
              disabled={isSaving}
              size="sm"
              className="bg-card shadow-md"
              data-testid="button-save-flow"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-1" />
                  Salvar Fluxo
                </>
              )}
            </Button>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

const FlowEditorInner = forwardRef<FlowEditorRef, FlowEditorProps>(FlowEditorInnerComponent);

const FlowEditor = forwardRef<FlowEditorRef, FlowEditorProps>((props, ref) => {
  return (
    <ReactFlowProvider>
      <FlowEditorInner ref={ref} {...props} />
    </ReactFlowProvider>
  );
});

FlowEditor.displayName = 'FlowEditor';
FlowEditorInner.displayName = 'FlowEditorInner';

export default FlowEditor;
