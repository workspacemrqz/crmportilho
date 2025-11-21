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
import { Plus, AlertCircle, Star, X, Save, Loader2, Trash2, Copy } from 'lucide-react';
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
  exampleMessage?: string;
  position?: { x: number; y: number } | any;
  transitions?: StepTransition[] | any;
};

type FlowEditorProps = {
  steps: FlowStep[];
  onStepsChange: (steps: FlowStep[] | ((prev: FlowStep[]) => FlowStep[])) => void;
  onNodeSelect: (step: FlowStep | null) => void;
  selectedNodeId: string | null;
  onNodeDelete?: (stepId: string) => void;
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
  const [isHovered, setIsHovered] = useState(false);
  const { toast } = useToast();

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

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.onDelete) {
      data.onDelete(data.stepId);
    }
  };
  
  return (
    <div 
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Hover action buttons - positioned above the node, each with its own container */}
      <div 
        className="absolute -top-10 right-0 flex items-center gap-2"
        style={{ visibility: isHovered ? 'visible' : 'hidden' }}
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
            className="h-7 w-7 text-destructive hover:text-destructive hover-elevate active-elevate-2"
            onClick={handleDelete}
            title="Deletar etapa"
            data-testid={`button-delete-node-${data.stepId}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      
      <div 
        className={`px-4 py-3 rounded-md border-2 bg-card min-w-[200px] shadow-lg transition-all hover:shadow-xl relative ${
          selected 
            ? 'border-primary ring-2 ring-primary/20' 
            : isStart 
            ? 'border-primary/60'
            : 'border-border'
        }`}
        data-testid={`node-${data.stepId}`}
      >
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm flex-1">{data.stepName}</div>
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
  { steps, onStepsChange, onNodeSelect, selectedNodeId, onNodeDelete, onSave, isSaving }: FlowEditorProps,
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
        nodesMapRef.current.set(newId, {
          ...oldNode,
          id: newId,
          data: { ...oldNode.data, stepId: newId }
        });
      }
      nodesMapRef.current.delete(oldId);
      
      // Atualizar React Flow nodes state IMEDIATAMENTE
      // Usa nodes state atual como fallback se não houver cache
      setNodes(prevNodes => 
        prevNodes.map(node => {
          if (node.id === oldId) {
            const migratedNode = nodesMapRef.current.get(newId);
            return migratedNode || {
              ...node,
              id: newId,
              data: { ...node.data, stepId: newId }
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
              isStart: index === 0,
              transitionsCount: Array.isArray(step.transitions) ? step.transitions.length : 0,
              onDelete: onNodeDelete,
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
          node.data.isStart !== (index === 0);
        
        if (needsUpdate) {
          const updatedNode = {
            ...node,
            data: {
              ...node.data,
              stepName: step.stepName,
              isStart: index === 0,
              onDelete: onNodeDelete,
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
              transitionsCount: newTransitionsCount,
              onDelete: onNodeDelete,
            }
          };
        }
        return node;
      });
    });
  }, [steps, setNodes, onNodeDelete]);

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
      
      // Handle node removal (when user presses Delete key)
      if (change.type === 'remove') {
        // Remove from positionsRef and nodesMapRef
        delete positionsRef.current[change.id];
        nodesMapRef.current.delete(change.id);
        
        // Update parent steps state to remove the deleted step
        onStepsChange((currentSteps: FlowStep[]) => {
          return currentSteps.filter((step) => step.stepId !== change.id);
        });
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

  const handleAddNode = useCallback(() => {
    onStepsChange((currentSteps: FlowStep[]) => {
      const stepName = 'Nova Etapa';
      const existingIds = currentSteps.map(s => s.stepId);
      const newStepId = generateStepId(stepName, existingIds);
      
      const newStep: FlowStep = {
        stepId: newStepId,
        stepName,
        objective: '',
        stepPrompt: '',
        routingInstructions: '',
        order: currentSteps.length,
        position: { 
          x: 100 + (currentSteps.length % 3) * 300, 
          y: 100 + Math.floor(currentSteps.length / 3) * 200 
        },
        transitions: [],
        exampleMessage: '',
      };

      return [...currentSteps, newStep];
    });
  }, [onStepsChange]);

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
          <Button
            onClick={handleAddNode}
            size="sm"
            variant="outline"
            className="bg-card shadow-md"
            data-testid="button-add-node"
          >
            <Plus className="w-4 h-4 mr-1" />
            Adicionar Etapa
          </Button>
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
