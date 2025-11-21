import { useCallback, useEffect, useState, useRef } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { FlowStepNode as FlowStepNodeType, StepTransition } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Plus, AlertCircle, Star } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Deep equality check for steps to avoid unnecessary rebuilds
function areStepsEqual(steps1: FlowStep[], steps2: FlowStep[]): boolean {
  if (steps1.length !== steps2.length) return false;
  
  return steps1.every((step1, index) => {
    const step2 = steps2[index];
    if (!step2) return false;
    
    // Compare essential properties (excluding position which is handled separately)
    const isSame = 
      step1.stepId === step2.stepId &&
      step1.stepName === step2.stepName &&
      step1.objective === step2.objective &&
      step1.stepPrompt === step2.stepPrompt &&
      step1.routingInstructions === step2.routingInstructions &&
      step1.order === step2.order &&
      step1.exampleMessage === step2.exampleMessage &&
      JSON.stringify(step1.transitions) === JSON.stringify(step2.transitions);
    
    return isSame;
  });
}

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

const FlowStepNode = ({ data, selected }: any) => {
  const isStart = data.isStart;
  const transitionsCount = data.transitionsCount || 0;
  
  return (
    <div 
      className={`px-4 py-3 rounded-md border-2 bg-card min-w-[200px] shadow-lg transition-all hover:shadow-xl ${
        selected 
          ? 'border-primary ring-2 ring-primary/20' 
          : isStart 
          ? 'border-primary/60'
          : 'border-border'
      }`}
      data-testid={`node-${data.stepId}`}
    >
      {/* Handle de entrada (topo) - mais visível */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!w-4 hover:!h-4 transition-all"
        style={{ top: -6 }}
        title="Conectar de outra etapa para esta"
        data-testid={`handle-target-top-${data.stepId}`}
      />
      
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
      
      {/* Handle de saída (baixo) - principal */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!w-4 hover:!h-4 transition-all"
        style={{ bottom: -6 }}
        title="Arrastar para conectar a outra etapa"
        data-testid={`handle-source-bottom-${data.stepId}`}
      />
      
      {/* Handles laterais para mais opções de conexão */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-primary/60 !border-2 !border-background hover:!w-3.5 hover:!h-3.5 transition-all"
        style={{ right: -5 }}
        title="Arrastar para conectar a outra etapa"
        data-testid={`handle-source-right-${data.stepId}`}
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-primary/60 !border-2 !border-background hover:!w-3.5 hover:!h-3.5 transition-all"
        style={{ left: -5 }}
        title="Conectar de outra etapa para esta"
        data-testid={`handle-target-left-${data.stepId}`}
      />
    </div>
  );
};

const nodeTypes = {
  flowStep: FlowStepNode,
};

function FlowEditorInner({ steps, onStepsChange, onNodeSelect, selectedNodeId }: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [invalidTransitions, setInvalidTransitions] = useState<string[]>([]);

  // Track previous steps and initialization state for delta reconciliation
  const prevStepsRef = useRef<FlowStep[]>([]);
  const isInitializedRef = useRef(false);
  const lastFullRebuildSelectedIdRef = useRef<string | null>(null);

  const convertStepsToNodes = useCallback((flowSteps: FlowStep[], selectedId: string | null = null): Node[] => {
    return flowSteps.map((step, index) => {
      const position = step.position && typeof step.position === 'object' && step.position.x !== undefined
        ? step.position
        : { x: 100 + (index % 3) * 300, y: 100 + Math.floor(index / 3) * 200 };

      const transitions = Array.isArray(step.transitions) ? step.transitions : [];

      return {
        id: step.stepId,
        type: 'flowStep',
        position,
        selected: step.stepId === selectedId,
        data: {
          stepId: step.stepId,
          stepName: step.stepName,
          isStart: index === 0,
          transitionsCount: transitions.length,
        },
      };
    });
  }, []);

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
        const label = transition.label || `Condição ${index + 1}`;

        allEdges.push({
          id: transition.id,
          source: step.stepId,
          target: transition.targetStepId,
          label,
          type: 'smoothstep',
          animated: true,
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
          labelStyle: {
            fontSize: 12,
            fontWeight: 500,
            fill: 'hsl(var(--foreground))',
            backgroundColor: 'hsl(var(--background))',
            padding: '4px 8px',
            borderRadius: '4px',
          },
          labelBgStyle: {
            fill: 'hsl(var(--card))',
            fillOpacity: 0.95,
          },
          labelBgPadding: [8, 4] as [number, number],
          labelBgBorderRadius: 4,
        });
      });
    });

    setInvalidTransitions(invalidTargets);
    return allEdges;
  }, []);

  // Main effect: Initialize or rebuild nodes/edges when steps structurally change
  useEffect(() => {
    const stepsChanged = !areStepsEqual(prevStepsRef.current, steps);
    
    if (!isInitializedRef.current || stepsChanged) {
      // Full rebuild needed - steps structure changed
      const newNodes = convertStepsToNodes(steps, selectedNodeId);
      const newEdges = convertTransitionsToEdges(steps);
      
      setNodes(newNodes);
      setEdges(newEdges);
      
      prevStepsRef.current = steps;
      isInitializedRef.current = true;
      lastFullRebuildSelectedIdRef.current = selectedNodeId;
    } else {
      // Only update positions if they changed (delta update)
      const positionChanges: NodeChange[] = [];
      
      steps.forEach((step) => {
        if (step.position && typeof step.position === 'object' && step.position.x !== undefined) {
          const prevStep = prevStepsRef.current.find(s => s.stepId === step.stepId);
          if (prevStep?.position && 
              (prevStep.position.x !== step.position.x || prevStep.position.y !== step.position.y)) {
            positionChanges.push({
              id: step.stepId,
              type: 'position',
              position: step.position,
            });
          }
        }
      });
      
      if (positionChanges.length > 0) {
        setNodes((nds) => applyNodeChanges(positionChanges, nds));
        prevStepsRef.current = steps;
      }
    }
  }, [steps, selectedNodeId, convertStepsToNodes, convertTransitionsToEdges, setNodes, setEdges]);

  // Selection effect: Update selection using delta changes when selectedNodeId changes
  useEffect(() => {
    if (lastFullRebuildSelectedIdRef.current !== selectedNodeId) {
      const selectionChanges: NodeChange[] = steps.map((step) => ({
        id: step.stepId,
        type: 'select',
        selected: step.stepId === selectedNodeId,
      }));
      
      if (selectionChanges.length > 0) {
        setNodes((nds) => applyNodeChanges(selectionChanges, nds));
      }
    }
  }, [selectedNodeId, steps, setNodes]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);
    
    // Apenas atualiza as posições dos steps quando terminar de arrastar
    changes.forEach((change) => {
      if (change.type === 'position' && change.position && !change.dragging) {
        const updatedSteps = steps.map((step) =>
          step.stepId === change.id
            ? { ...step, position: change.position }
            : step
        );
        onStepsChange(updatedSteps);
      }
    });
  }, [onNodesChange, steps, onStepsChange]);

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

    // Encontra as etapas de origem e destino
    const sourceStep = steps.find(s => s.stepId === connection.source);
    const targetStep = steps.find(s => s.stepId === connection.target);
    
    if (!sourceStep || !targetStep) return;

    // Verifica se já existe uma transição para este destino
    const existingTransitions = Array.isArray(sourceStep.transitions) ? sourceStep.transitions : [];
    const alreadyConnected = existingTransitions.some(t => t.targetStepId === connection.target);
    
    if (alreadyConnected) {
      // Já existe conexão, apenas seleciona o node de origem para editar
      onNodeSelect(sourceStep);
      return;
    }

    // Cria nova transição
    const newTransition: StepTransition = {
      id: `transition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      label: `→ ${targetStep.stepName}`,
      targetStepId: connection.target,
    };

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
    
    // Seleciona o node de origem para que o usuário possa editar a transição no modal
    setTimeout(() => {
      onNodeSelect(updatedSteps.find(s => s.stepId === connection.source) || null);
    }, 100);
  }, [steps, onStepsChange, onNodeSelect]);

  const handleNodeClick = useCallback((_event: any, node: Node) => {
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
    onNodeSelect(newStep);
  }, [steps, onStepsChange, onNodeSelect]);

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
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
        }}
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
