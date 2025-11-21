import { useCallback, useEffect, useState, useRef, memo, useMemo } from 'react';
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
import { Plus, AlertCircle, Star, X, GripVertical } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
  onStepsChange: (steps: FlowStep[]) => void;
  onNodeSelect: (step: FlowStep | null) => void;
  selectedNodeId: string | null;
};

const FlowStepNode = memo(({ data, selected }: any) => {
  const isStart = data.isStart;
  const transitionsCount = data.transitionsCount || 0;
  
  return (
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
      {/* Drag handle - visual indicator */}
      <div 
        className="absolute top-0 left-0 h-full w-8 flex items-center justify-center cursor-move"
        data-testid={`drag-handle-${data.stepId}`}
      >
        <GripVertical className="w-4 h-4 text-muted-foreground/40" />
      </div>
      
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

const MIN_DISTANCE = 150; // Distância mínima para Proximity Connect
const TEMP_PROXIMITY_EDGE = 'TEMP_PROXIMITY_EDGE'; // Fixed ID for temporary proximity edge

// Função para calcular hash estrutural (ignora transitions e positions)
function getStructuralHash(steps: FlowStep[]): string {
  return steps
    .map(s => `${s.stepId}|${s.stepName}|${s.objective}|${s.stepPrompt}|${s.routingInstructions}|${s.order}|${s.exampleMessage || ''}`)
    .sort()
    .join('::');
}

function FlowEditorInner({ steps, onStepsChange, onNodeSelect, selectedNodeId }: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [invalidTransitions, setInvalidTransitions] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);

  // Memoize nodeTypes and edgeTypes to prevent React Flow warnings
  const memoizedNodeTypes = useMemo(() => nodeTypes, []);
  const memoizedEdgeTypes = useMemo(() => edgeTypes, []);

  // Proximity Connect - Store API
  const store = useStoreApi();

  // PRIMARY state refs - source of truth
  const positionsRef = useRef<Record<string, {x: number, y: number}>>({});
  const nodesMapRef = useRef<Map<string, Node>>(new Map());
  const fitViewOnInitRef = useRef(true);
  
  // Ref para acessar steps atual sem depender dele no effect
  const stepsRef = useRef<FlowStep[]>(steps);
  
  // Hash estrutural para detectar mudanças estruturais (exclui transitions e positions)
  const structuralHash = useMemo(() => getStructuralHash(steps), [steps]);
  
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
              transitionsCount: newTransitionsCount
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
          const updatedSteps = steps.map((step) =>
            step.stepId === change.id
              ? { ...step, position: change.position }
              : step
          );
          onStepsChange(updatedSteps);
        }
      }
    });
  }, [steps, onStepsChange, onNodesChange]);

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
    const newStepId = `etapa_${Date.now()}`;
    const newStep: FlowStep = {
      stepId: newStepId,
      stepName: 'Nova Etapa',
      objective: '',
      stepPrompt: '',
      routingInstructions: '',
      order: steps.length,
      position: { 
        x: 100 + (steps.length % 3) * 300, 
        y: 100 + Math.floor(steps.length / 3) * 200 
      },
      transitions: [],
      exampleMessage: '',
    };

    const updatedSteps = [...steps, newStep];
    onStepsChange(updatedSteps);
  }, [steps, onStepsChange]);

  // Proximity Connect - encontra o node mais próximo
  const getClosestEdge = useCallback((node: Node) => {
    const { nodeInternals } = store.getState();
    const currentNode = nodeInternals.get(node.id);

    if (!currentNode || !currentNode.positionAbsolute) return null;

    const closestNode = Array.from(nodeInternals.values()).reduce(
      (res: any, n: any) => {
        if (n.id !== currentNode.id && n.positionAbsolute && currentNode.positionAbsolute) {
          const dx =
            n.positionAbsolute.x -
            currentNode.positionAbsolute.x;
          const dy =
            n.positionAbsolute.y -
            currentNode.positionAbsolute.y;
          const d = Math.sqrt(dx * dx + dy * dy);

          if (d < res.distance && d < MIN_DISTANCE) {
            res.distance = d;
            res.node = n;
          }
        }

        return res;
      },
      {
        distance: Number.MAX_VALUE,
        node: null,
      },
    );

    if (!closestNode.node || !closestNode.node.positionAbsolute || !currentNode.positionAbsolute) {
      return null;
    }

    const closeNodeIsSource =
      closestNode.node.positionAbsolute.x <
      currentNode.positionAbsolute.x;

    return {
      id: closeNodeIsSource
        ? `${closestNode.node.id}-${node.id}`
        : `${node.id}-${closestNode.node.id}`,
      source: closeNodeIsSource ? closestNode.node.id : node.id,
      target: closeNodeIsSource ? node.id : closestNode.node.id,
      type: 'custom' as const,
      animated: true,
    };
  }, [store]);

  // Proximity Connect - enquanto arrasta, mostra conexão temporária
  const onNodeDrag = useCallback(
    (_: any, node: Node) => {
      const closeEdge = getClosestEdge(node);

      setEdges((es) => {
        // Remove temp edge by fixed ID
        const nextEdges = es.filter((e) => e.id !== TEMP_PROXIMITY_EDGE);

        if (closeEdge) {
          // Guard: Prevent self-connections
          if (closeEdge.source === closeEdge.target) {
            return nextEdges;
          }

          // Guard: Prevent duplicate connections
          const alreadyExists = nextEdges.find(
            (ne) => ne.source === closeEdge.source && ne.target === closeEdge.target,
          );

          if (!alreadyExists) {
            // Create temp edge with fixed ID
            const tempEdge: Edge = {
              id: TEMP_PROXIMITY_EDGE,
              source: closeEdge.source,
              target: closeEdge.target,
              type: 'custom',
              animated: true,
              style: { strokeDasharray: '5', opacity: 0.5, stroke: 'hsl(var(--primary))' },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 20,
                height: 20,
                color: 'hsl(var(--primary))',
              },
            };
            nextEdges.push(tempEdge);
          }
        }

        return nextEdges;
      });
    },
    [getClosestEdge, setEdges],
  );

  // Proximity Connect - ao soltar, cria a conexão real
  const onNodeDragStop = useCallback(
    (_: any, node: Node) => {
      const closeEdge = getClosestEdge(node);

      // Remove temp edge by ID
      setEdges((es) => es.filter((e) => e.id !== TEMP_PROXIMITY_EDGE));

      // Create real connection if valid
      if (closeEdge) {
        // Guard: Prevent self-connections
        if (closeEdge.source === closeEdge.target) {
          return;
        }

        const sourceStep = steps.find(s => s.stepId === closeEdge.source);
        const targetStep = steps.find(s => s.stepId === closeEdge.target);
        
        if (sourceStep && targetStep) {
          // Guard: Prevent duplicate connections
          const existingTransitions = Array.isArray(sourceStep.transitions) ? sourceStep.transitions : [];
          const alreadyConnected = existingTransitions.some(t => t.targetStepId === closeEdge.target);
          
          if (!alreadyConnected) {
            // Create real connection via onConnect
            onConnect({
              source: closeEdge.source,
              target: closeEdge.target,
            } as Connection);
          }
        }
      }
    },
    [getClosestEdge, steps, onConnect, setEdges],
  );

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
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={memoizedNodeTypes}
        edgeTypes={memoizedEdgeTypes}
        fitView={fitViewOnInitRef.current}
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
      </ReactFlow>
    </div>
  );
}

export default function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
