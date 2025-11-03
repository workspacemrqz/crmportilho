import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  Edit, 
  CheckCircle2, 
  AlertCircle,
  RotateCcw,
  Save,
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WorkflowTemplate = {
  id: string;
  parentId: string | null;
  templateKey: string;
  name: string;
  description: string | null;
  content: string;
  defaultContent: string;
  category: string | null;
  requiredVariables: string[];
  status: string;
  isActive: boolean;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type WorkflowTreeNode = WorkflowTemplate & {
  children: WorkflowTreeNode[];
  level: number;
};

type WorkflowVersion = {
  id: string;
  templateId: string;
  version: number;
  content: string;
  status: string;
  changeDescription: string | null;
  createdBy: string | null;
  createdAt: string;
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  inactive: "Inativo",
  archived: "Arquivado",
};

const statusColors: Record<string, string> = {
  draft: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
  active: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  inactive: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  archived: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

const workflowFormSchema = z.object({
  description: z.string().optional(),
  content: z.string().min(1, "Conteúdo não pode estar vazio"),
});

type WorkflowFormData = z.infer<typeof workflowFormSchema>;

// React Query Hooks
function useWorkflows(filters?: { status?: string; category?: string; isActive?: boolean }) {
  const queryParams = new URLSearchParams();
  if (filters?.status) queryParams.set('status', filters.status);
  if (filters?.category) queryParams.set('category', filters.category);
  if (filters?.isActive !== undefined) queryParams.set('isActive', String(filters.isActive));
  
  const queryString = queryParams.toString();
  const endpoint = queryString ? `/api/workflows?${queryString}` : '/api/workflows';
  
  return useQuery<WorkflowTemplate[]>({
    queryKey: ['/api/workflows', filters],
    queryFn: async () => {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Failed to fetch workflows');
      return response.json();
    },
  });
}

function useWorkflow(id: string | null) {
  return useQuery<WorkflowTemplate>({
    queryKey: ['/api/workflows', id],
    queryFn: async () => {
      if (!id) throw new Error('No workflow ID provided');
      const response = await fetch(`/api/workflows/${id}`);
      if (!response.ok) throw new Error('Failed to fetch workflow');
      return response.json();
    },
    enabled: !!id,
  });
}

function useWorkflowVersions(id: string | null) {
  return useQuery<WorkflowVersion[]>({
    queryKey: ['/api/workflows', id, 'versions'],
    queryFn: async () => {
      if (!id) throw new Error('No workflow ID provided');
      const response = await fetch(`/api/workflows/${id}/versions`);
      if (!response.ok) throw new Error('Failed to fetch workflow versions');
      return response.json();
    },
    enabled: !!id,
  });
}

function useUpdateWorkflow() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest('PUT', `/api/workflows/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      toast({
        title: "Workflow atualizado",
        description: "As alterações foram salvas com sucesso.",
      });
    },
    onError: (error: any) => {
      let description = error.message || "Não foi possível salvar as alterações.";
      
      // If the error includes missing variables, display them
      if (error.missingVariables && Array.isArray(error.missingVariables)) {
        description = `Variáveis obrigatórias ausentes: ${error.missingVariables.join(', ')}`;
      }
      
      toast({
        title: "Erro ao atualizar workflow",
        description: description,
        variant: "destructive",
      });
    },
  });
}

function useToggleWorkflow() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest('POST', `/api/workflows/${id}/toggle`, { isActive, updatedBy: 'admin' });
    },
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/workflows'] });
      
      const previousWorkflows = queryClient.getQueryData<WorkflowTemplate[]>(['/api/workflows']);
      
      queryClient.setQueryData<WorkflowTemplate[]>(['/api/workflows'], (old) => {
        if (!old) return old;
        return old.map((workflow) =>
          workflow.id === id ? { ...workflow, isActive } : workflow
        );
      });
      
      return { previousWorkflows };
    },
    onError: (error, variables, context) => {
      if (context?.previousWorkflows) {
        queryClient.setQueryData(['/api/workflows'], context.previousWorkflows);
      }
      toast({
        title: "Erro ao alternar status",
        description: "Não foi possível alterar o status do workflow.",
        variant: "destructive",
      });
    },
    onSuccess: (data, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      toast({
        title: isActive ? "Workflow ativado" : "Workflow desativado",
        description: `O workflow foi ${isActive ? 'ativado' : 'desativado'} com sucesso.`,
      });
    },
  });
}

function useRestoreWorkflow() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/workflows/${id}/restore`, { updatedBy: 'admin' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      toast({
        title: "Workflow restaurado",
        description: "O conteúdo padrão foi restaurado com sucesso.",
      });
    },
    onError: () => {
      toast({
        title: "Erro ao restaurar workflow",
        description: "Não foi possível restaurar o conteúdo padrão.",
        variant: "destructive",
      });
    },
  });
}

function useValidateWorkflow() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      return apiRequest('POST', `/api/workflows/${id}/validate`, { content });
    },
    onSuccess: (data: any) => {
      if (data.valid) {
        toast({
          title: "Validação bem-sucedida",
          description: "O conteúdo do workflow está válido.",
        });
      } else {
        toast({
          title: "Validação falhou",
          description: data.error || "O conteúdo possui erros.",
          variant: "destructive",
        });
      }
      return data;
    },
    onError: () => {
      toast({
        title: "Erro na validação",
        description: "Não foi possível validar o workflow.",
        variant: "destructive",
      });
    },
  });
}

// Helper to build hierarchical tree from flat workflow list
const buildWorkflowTree = (workflows: WorkflowTemplate[]): WorkflowTreeNode[] => {
  const workflowMap = new Map<string, WorkflowTreeNode>();
  const rootNodes: WorkflowTreeNode[] = [];

  workflows.forEach(workflow => {
    workflowMap.set(workflow.id, {
      ...workflow,
      children: [],
      level: 0
    });
  });

  workflows.forEach(workflow => {
    const node = workflowMap.get(workflow.id)!;
    if (workflow.parentId && workflowMap.has(workflow.parentId)) {
      const parent = workflowMap.get(workflow.parentId)!;
      node.level = parent.level + 1;
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  return rootNodes;
};

// Helper to flatten tree for filtering
const flattenTree = (nodes: WorkflowTreeNode[]): WorkflowTreeNode[] => {
  const result: WorkflowTreeNode[] = [];
  const traverse = (node: WorkflowTreeNode) => {
    result.push(node);
    node.children.forEach(traverse);
  };
  nodes.forEach(traverse);
  return result;
};

// Helper to find path to a workflow node (returns array of parent IDs)
const findPathToNode = (
  nodes: WorkflowTreeNode[],
  targetId: string,
  currentPath: string[] = []
): string[] | null => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return currentPath;
    }
    if (node.children.length > 0) {
      const pathInChildren = findPathToNode(
        node.children,
        targetId,
        [...currentPath, node.id]
      );
      if (pathInChildren) {
        return pathInChildren;
      }
    }
  }
  return null;
};

// Helper to escape regex special characters
const escapeRegex = (str: string) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Helper function to render content with placeholder values
function renderPreview(content: string, requiredVariables: string[]): string {
  // Map of placeholder to example value
  const placeholderMap: Record<string, string> = {
    '[NOME_DA_IA]': 'Serena',
    '[NÚMERO_DO_PROTOCOLO]': '2024-001',
    '[DD/MM/AAAA]': '01/11/2024',
    '[NÚMERO_DE_TELEFONE]': '(11) 99999-9999',
    '[NOME_COMPLETO]': 'João Silva',
    '[EMAIL]': 'joao.silva@exemplo.com',
    '[ENDEREÇO]': 'Rua das Flores, 123',
    '[CIDADE]': 'São Paulo',
    '[ESTADO]': 'SP',
    '[CEP]': '01234-567',
    '[CPF]': '123.456.789-00',
    '[CNPJ]': '12.345.678/0001-90',
    '[MARCA]': 'Toyota',
    '[MODELO]': 'Corolla',
    '[ANO]': '2023',
    '[PLACA]': 'ABC-1234',
    '[COR]': 'Prata',
    '[CHASSI]': '9BWZZZ377VT004251',
    '[VALOR]': 'R$ 85.000,00',
  };
  
  let result = content;
  
  // Replace each placeholder exactly once
  requiredVariables.forEach(variable => {
    const exampleValue = placeholderMap[variable] || `Exemplo_${variable.replace(/[\[\]]/g, '')}`;
    result = result.replace(new RegExp(escapeRegex(variable), 'g'), exampleValue);
  });
  
  return result;
}

// Workflow Tree Node Component
function WorkflowTreeNodeComponent({
  node,
  onEdit,
  onToggle,
  toggleMutation,
  expandedNodes,
  setExpandedNodes,
}: {
  node: WorkflowTreeNode;
  onEdit: (workflow: WorkflowTemplate) => void;
  onToggle: (workflow: WorkflowTemplate) => void;
  toggleMutation: any;
  expandedNodes: Set<string>;
  setExpandedNodes: (setter: (prev: Set<string>) => Set<string>) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);

  const toggleExpand = () => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  };

  return (
    <div data-testid={`tree-node-${node.id}`}>
      <div
        className={`flex items-center gap-2 p-3 border rounded-md hover-elevate ${
          node.level > 0 ? 'ml-8' : ''
        }`}
        style={{ marginLeft: `${node.level * 2}rem` }}
      >
        <div className="flex items-center gap-2 flex-1">
          {hasChildren && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleExpand}
              data-testid={`button-toggle-${node.id}`}
              className="h-6 w-6"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          )}
          {!hasChildren && <div className="w-6" />}
          
          {hasChildren ? (
            isExpanded ? (
              <FolderOpen className="h-5 w-5 text-primary" />
            ) : (
              <Folder className="h-5 w-5 text-primary" />
            )
          ) : (
            <FileText className="h-5 w-5 text-muted-foreground" />
          )}

          <div className="flex-1">
            <div className="font-medium" data-testid={`text-name-${node.id}`}>
              {node.name}
            </div>
            <div className="text-xs text-muted-foreground">
              <code className="bg-muted px-1 py-0.5 rounded">
                {node.templateKey}
              </code>
              {node.category && (
                <span className="ml-2">{node.category}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className={statusColors[node.status]}
              data-testid={`badge-status-${node.id}`}
            >
              {statusLabels[node.status]}
            </Badge>
            
            <div className="text-sm text-muted-foreground">
              v{node.version}
            </div>

            <Switch
              checked={node.isActive}
              onCheckedChange={() => onToggle(node)}
              disabled={toggleMutation.isPending}
              data-testid={`switch-active-${node.id}`}
            />

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(node)}
              data-testid={`button-edit-${node.id}`}
            >
              <Edit className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="mt-2 space-y-2" data-testid={`children-${node.id}`}>
          {node.children.map((child) => (
            <WorkflowTreeNodeComponent
              key={child.id}
              node={child}
              onEdit={onEdit}
              onToggle={onToggle}
              toggleMutation={toggleMutation}
              expandedNodes={expandedNodes}
              setExpandedNodes={setExpandedNodes}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Workflow Editor Modal Component
function WorkflowEditorModal({ 
  workflowId, 
  isOpen, 
  onClose 
}: { 
  workflowId: string | null; 
  isOpen: boolean; 
  onClose: () => void;
}) {
  const { data: workflow, isLoading: isLoadingWorkflow } = useWorkflow(workflowId);
  const updateMutation = useUpdateWorkflow();
  const restoreMutation = useRestoreWorkflow();
  const { toast } = useToast();

  const form = useForm<WorkflowFormData>({
    resolver: zodResolver(workflowFormSchema),
    defaultValues: {
      description: workflow?.description || "",
      content: workflow?.content || "",
    },
  });

  // Update form when workflow data loads
  useEffect(() => {
    if (workflow) {
      form.reset({
        description: workflow.description || "",
        content: workflow.content || "",
      });
    }
  }, [workflow, form]);

  const watchedContent = form.watch('content');

  // Validate required variables in real-time
  const missingVariables = useMemo(() => {
    if (!workflow?.requiredVariables || !watchedContent) return [];
    return workflow?.requiredVariables?.filter(
      (variable) => !watchedContent.includes(variable)
    ) || [];
  }, [watchedContent, workflow?.requiredVariables]);

  const isContentValid = missingVariables.length === 0;

  const handleSave = async (data: WorkflowFormData) => {
    if (!workflowId) return;
    
    if (!isContentValid) {
      toast({
        title: "Erro de validação",
        description: "Todas as variáveis obrigatórias devem estar presentes no conteúdo.",
        variant: "destructive",
      });
      return;
    }

    await updateMutation.mutateAsync({
      id: workflowId,
      data: { ...data, updatedBy: 'admin' },
    });
    
    onClose();
  };

  const handleRestore = async () => {
    if (!workflowId) return;
    await restoreMutation.mutateAsync(workflowId);
    onClose();
  };

  if (isLoadingWorkflow) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl h-[80vh]" data-testid="dialog-workflow-editor">
          <div className="flex items-center justify-center h-full">
            <div className="space-y-4 w-full p-8">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-96 w-full" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!workflow) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[80vh]" data-testid="dialog-workflow-editor">
        <DialogHeader>
          <DialogTitle data-testid="text-workflow-name">{workflow.name}</DialogTitle>
          <DialogDescription>
            Edite o conteúdo do workflow
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSave)} className="h-full flex flex-col">
              <div className="flex-1 overflow-auto space-y-4 pr-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label data-testid="label-template-key">Chave do Template</Label>
                      <Input 
                        value={workflow.templateKey} 
                        disabled 
                        className="bg-muted"
                        data-testid="input-template-key"
                      />
                    </div>
                    <div>
                      <Label data-testid="label-category">Categoria</Label>
                      <Input 
                        value={workflow.category || 'N/A'} 
                        disabled 
                        className="bg-muted"
                        data-testid="input-category"
                      />
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descrição</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Descrição opcional"
                            data-testid="input-description"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div>
                    <Label className="mb-2 block">Variáveis Obrigatórias</Label>
                    <div className="flex flex-wrap gap-2" data-testid="container-required-variables">
                      {workflow?.requiredVariables && workflow.requiredVariables.length > 0 ? (
                        workflow?.requiredVariables?.map((variable) => {
                          const isMissing = missingVariables.includes(variable);
                          return (
                            <Badge
                              key={variable}
                              variant={isMissing ? "destructive" : "default"}
                              data-testid={`badge-variable-${variable}`}
                            >
                              {isMissing && <AlertCircle className="h-3 w-3 mr-1" />}
                              {!isMissing && <CheckCircle2 className="h-3 w-3 mr-1" />}
                              {variable}
                            </Badge>
                          );
                        })
                      ) : (
                        <span className="text-sm text-muted-foreground">Nenhuma variável obrigatória</span>
                      )}
                    </div>
                    {missingVariables.length > 0 && (
                      <p className="text-sm text-destructive mt-2" data-testid="text-missing-variables">
                        Variáveis ausentes: {missingVariables.join(', ')}
                      </p>
                    )}
                  </div>

                  <FormField
                    control={form.control}
                    name="content"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conteúdo</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Digite o conteúdo do workflow..."
                            className="min-h-[300px] font-mono text-sm"
                            data-testid="textarea-content"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Use as variáveis obrigatórias no formato exato mostrado acima.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

              <Separator className="my-4" />

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  data-testid="button-cancel"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRestore}
                  disabled={restoreMutation.isPending}
                  data-testid="button-restore-default"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restaurar Padrão
                </Button>
                <Button
                  type="submit"
                  disabled={!isContentValid || updateMutation.isPending}
                  data-testid="button-save"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Main Workflows Page Component
export default function Workflows() {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  
  const { data: workflows = [], isLoading } = useWorkflows();
  const toggleMutation = useToggleWorkflow();

  const handleEdit = (workflow: WorkflowTemplate) => {
    const path = findPathToNode(workflowTree, workflow.id);
    if (path && path.length > 0) {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        path.forEach((id) => next.add(id));
        return next;
      });
    }
    
    setEditingWorkflowId(workflow.id);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setEditingWorkflowId(null);
  };

  const handleToggle = async (workflow: WorkflowTemplate) => {
    await toggleMutation.mutateAsync({
      id: workflow.id,
      isActive: !workflow.isActive,
    });
  };

  // Get unique categories for filter
  const categories = useMemo(() => {
    const uniqueCategories = new Set(
      workflows.map((w) => w.category).filter((c): c is string => !!c)
    );
    return Array.from(uniqueCategories);
  }, [workflows]);

  const workflowTree = useMemo(() => {
    return buildWorkflowTree(workflows);
  }, [workflows]);

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((workflow) => {
      const matchesSearch =
        searchTerm === "" ||
        workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        workflow.templateKey.toLowerCase().includes(searchTerm.toLowerCase()) ||
        workflow.description?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory =
        categoryFilter === "all" || workflow.category === categoryFilter;

      const matchesStatus =
        statusFilter === "all" || workflow.status === statusFilter;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [workflows, searchTerm, categoryFilter, statusFilter]);

  const filteredTree = useMemo(() => {
    if (searchTerm || categoryFilter !== "all" || statusFilter !== "all") {
      return buildWorkflowTree(filteredWorkflows);
    }
    return workflowTree;
  }, [workflowTree, filteredWorkflows, searchTerm, categoryFilter, statusFilter]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-6 border-b space-y-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-workflows-title">
            Workflows
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure os templates de mensagens e fluxos do chatbot
          </p>
        </div>

        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, chave ou descrição..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-workflows"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Categorias</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Status</SelectItem>
              {Object.entries(statusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span data-testid="text-workflows-count">
            {filteredWorkflows.length}{" "}
            {filteredWorkflows.length === 1 ? "workflow" : "workflows"}
          </span>
          {(searchTerm || categoryFilter !== "all" || statusFilter !== "all") && (
            <span>
              (filtrado de {workflows.length}{" "}
              {workflows.length === 1 ? "total" : "totais"})
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum workflow encontrado</h3>
            <p className="text-sm text-muted-foreground">
              {searchTerm || categoryFilter !== "all" || statusFilter !== "all"
                ? "Tente ajustar os filtros de busca"
                : "Nenhum workflow disponível"}
            </p>
          </div>
        ) : (
          <div className="p-6 space-y-2" data-testid="workflow-tree">
            {filteredTree.map((node) => (
              <WorkflowTreeNodeComponent
                key={node.id}
                node={node}
                onEdit={handleEdit}
                onToggle={handleToggle}
                toggleMutation={toggleMutation}
                expandedNodes={expandedNodes}
                setExpandedNodes={setExpandedNodes}
              />
            ))}
          </div>
        )}
      </div>

      <WorkflowEditorModal
        workflowId={editingWorkflowId}
        isOpen={isEditorOpen}
        onClose={handleCloseEditor}
      />
    </div>
  );
}
