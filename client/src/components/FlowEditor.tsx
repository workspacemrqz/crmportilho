import { useCallback, useEffect, useState } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { FlowStepNode as FlowStepNodeType, StepTransition } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Plus, AlertCircle } from 'lucide-react';
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

const nodeTypes = {
  flowStep: ({ data }: any) => {
    const isSelected = data.isSelected;
    const isStart = data.isStart;
    
    return (
      <div 
        className={`px-4 py-3 rounded-md border-2 bg-card min-w-[180px] shadow-md transition-all ${
          isSelected 
            ? 'border-primary ring-2 ring-primary/20' 
            : isStart 
            ? 'border-primary/60'
            : 'border-border'
        }`}
        data-testid={`node-${data.stepId}`}
      >
        <div className="font-semibold text-sm mb-1">{data.stepName}</div>
        <div className="text-xs text-muted-foreground">ID: {data.stepId}</div>
        {isStart && (
          <div className="mt-1 text-xs text-primary font-medium">Início</div>
        )}
      </div>
    );
  },
};

function FlowEditorInner({ steps, onStepsChange, onNodeSelect, selectedNodeId }: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [invalidTransitions, setInvalidTransitions] = useState<string[]>([]);

  const convertStepsToNodes = useCallback((flowSteps: FlowStep[]): Node[] => {
    return flowSteps.map((step, index) => {
      const position = step.position && typeof step.position === 'object' && step.position.x !== undefined
        ? step.position
        : { x: 100 + (index % 3) * 300, y: 100 + Math.floor(index / 3) * 200 };

      return {
        id: step.stepId,
        type: 'flowStep',
        position,
        data: {
          stepId: step.stepId,
          stepName: step.stepName,
          isSelected: step.stepId === selectedNodeId,
          isStart: index === 0,
        },
      };
    });
  }, [selectedNodeId]);

  const convertTransitionsToEdges = useCallback((flowSteps: FlowStep[]): Edge[] => {
    const allEdges: Edge[] = [];
    const validStepIds = new Set(flowSteps.map(s => s.stepId));
    const invalidTargets: string[] = [];

    flowSteps.forEach((step) => {
      const transitions = Array.isArray(step.transitions) ? step.transitions : [];
      
      transitions.forEach((transition: StepTransition) => {
        const isValid = validStepIds.has(transition.targetStepId);
        
        if (!isValid) {
          invalidTargets.push(`${step.stepId} → ${transition.targetStepId}`);
        }

        allEdges.push({
          id: transition.id,
          source: step.stepId,
          target: transition.targetStepId,
          label: transition.label || 'condição',
          type: 'smoothstep',
          animated: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
          },
          style: {
            strokeWidth: 2,
            stroke: isValid ? 'hsl(var(--foreground))' : 'hsl(var(--destructive))',
          },
          labelStyle: {
            fontSize: 11,
            fill: 'hsl(var(--foreground))',
          },
        });
      });
    });

    setInvalidTransitions(invalidTargets);
    return allEdges;
  }, []);

  useEffect(() => {
    const newNodes = convertStepsToNodes(steps);
    const newEdges = convertTransitionsToEdges(steps);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [steps, convertStepsToNodes, convertTransitionsToEdges, setNodes, setEdges]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);
    
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

    const newTransition: StepTransition = {
      id: `transition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      label: '',
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
    onNodeSelect(updatedSteps.find(s => s.stepId === connection.source) || null);
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
