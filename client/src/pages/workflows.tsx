import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  Edit, 
  CheckCircle2, 
  AlertCircle,
  RotateCcw,
  Save,
  MessageSquare,
  Bot,
  User,
  Settings,
  Hash,
  ChevronRight,
  Copy,
  Trash,
  Plus,
  Brain,
  Sparkles,
  Eye,
  Clock,
  Users,
  Database,
  GitBranch,
  Zap,
  Shield,
  FileText,
  ArrowRight,
  Phone,
  CheckCircle,
  XCircle,
  PlayCircle,
  PauseCircle,
  Info,
  RefreshCw,
  Calculator,
  AlertTriangle
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

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
  isAIGenerated?: boolean;
};

// Define workflow categories with icons and descriptions
const workflowCategories = {
  initial: {
    name: "Mensagens Iniciais",
    icon: MessageSquare,
    description: "Mensagens de boas-vindas e primeiro contato",
    color: "bg-orange-500/10 text-orange-700 dark:text-orange-400"
  },
  menu: {
    name: "Menus",
    icon: Hash,
    description: "Menus de navegação e seleção de opções",
    color: "bg-green-500/10 text-green-700 dark:text-green-400"
  },
  menu1: {
    name: "Menu 1 - Seguros Novos",
    icon: FileText,
    description: "Fluxo de seguros novos - geral",
    color: "bg-orange-500/10 text-orange-700 dark:text-orange-400"
  },
  menu2: {
    name: "Menu 2 - Autorio",
    icon: Zap,
    description: "Fluxo de seguros Autorio",
    color: "bg-red-500/10 text-red-700 dark:text-red-400"
  },
  menu3: {
    name: "Menu 3 - Renovação",
    icon: RefreshCw,
    description: "Fluxo de renovação de seguros",
    color: "bg-orange-500/10 text-orange-700 dark:text-orange-400"
  },
  menu4: {
    name: "Menu 4 - Endosso",
    icon: Edit,
    description: "Fluxo de alterações em apólice",
    color: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
  },
  menu5: {
    name: "Menu 5 - Parcelas",
    icon: Calculator,
    description: "Fluxo de parcelas e boletos",
    color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  },
  menu6: {
    name: "Menu 6 - Sinistros",
    icon: AlertTriangle,
    description: "Fluxo de sinistros e assistências",
    color: "bg-rose-500/10 text-rose-700 dark:text-rose-400"
  },
  ai_response: {
    name: "Respostas com IA",
    icon: Brain,
    description: "Mensagens geradas dinamicamente pela IA",
    color: "bg-purple-500/10 text-purple-700 dark:text-purple-400"
  },
  auto: {
    name: "Fluxo Auto",
    icon: MessageSquare,
    description: "Mensagens específicas para seguro automotivo",
    color: "bg-orange-500/10 text-orange-700 dark:text-orange-400"
  },
  general: {
    name: "Geral",
    icon: Settings,
    description: "Outras mensagens e templates",
    color: "bg-gray-500/10 text-gray-700 dark:text-gray-400"
  }
};

// Workflow flow structure - Reflete a implementação atual do chatbot
const workflowFlow = [
  {
    id: "initial_flow",
    name: "Fluxo Inicial",
    description: "Cliente envia primeira mensagem - bot responde com boas-vindas e menu principal",
    steps: [
      { key: "MENSAGEM1", name: "Boas-vindas (com protocolo)", isAI: false },
      { key: "MENSAGEM2", name: "Menu Principal (6 opções)", isAI: false }
    ]
  },
  {
    id: "menu1_flow",
    name: "Menu 1 - Seguros Novos",
    description: "Cliente escolhe opção 1 - Cotação de seguros novos",
    steps: [
      { key: "MENU1_ABERTURA", name: "Como conheceu a corretora?", isAI: true },
      { key: "MENU1_TIPO_SEGURO", name: "Escolher tipo de seguro", isAI: false },
      { key: "MENU1_COTACAO_OUTRA_CORRETORA_1", name: "Cotação outra corretora - Passo 1", isAI: false },
      { key: "MENU1_COTACAO_OUTRA_CORRETORA_2", name: "Cotação outra corretora - Passo 2", isAI: false }
    ]
  },
  {
    id: "menu2_flow",
    name: "Menu 2 - Seguros Novos - Autorio",
    description: "Cliente escolhe opção 2 - Cotação de seguros Autorio",
    steps: [
      { key: "MENU2_AUTORIO_STATUS", name: "Veículo já está com você?", isAI: true },
      { key: "MENU2_AUTORIO_URGENTE", name: "Cotação URGENTE (veículo com cliente)", isAI: false },
      { key: "MENU2_AUTORIO_QUANDO_PEGA", name: "Quando vai pegar o veículo?", isAI: true },
      { key: "MENU2_AUTORIO_PRIORIDADE_PADRAO", name: "Prioridade padrão (transferir para humano)", isAI: false }
    ]
  },
  {
    id: "auto_flow",
    name: "Fluxo Auto Completo",
    description: "Fluxo completo quando cliente escolhe Seguro Auto",
    steps: [
      { key: "AUTO_ABERTURA", name: "Abertura do fluxo Auto", isAI: false },
      { key: "AUTO_URGENTE", name: "Mensagem para veículo urgente", isAI: false },
      { key: "AUTO_QUANDO_PEGA", name: "Quando vai pegar o veículo?", isAI: true },
      { key: "AUTO_DADOS_PESSOAIS", name: "Coletar dados pessoais", isAI: true },
      { key: "AUTO_DADOS_VEICULO_ESTACIONAMENTO", name: "Onde estaciona?", isAI: true },
      { key: "AUTO_DADOS_VEICULO_PORTAO", name: "Tipo de portão?", isAI: true },
      { key: "AUTO_DADOS_VEICULO_TRABALHO_ESTUDO", name: "Usa para trabalho/estudo?", isAI: true },
      { key: "AUTO_DADOS_VEICULO_MORADIA", name: "Tipo de moradia?", isAI: true },
      { key: "AUTO_DADOS_VEICULO_CARRO_RESERVA", name: "Dias de carro reserva?", isAI: true },
      { key: "AUTO_DADOS_VEICULO_REBOQUE", name: "Deseja reboque?", isAI: true },
      { key: "AUTO_DADOS_VEICULO_CONDUTOR_MENOR_25", name: "Condutor menor de 25?", isAI: true },
      { key: "AUTO_DADOS_VEICULO_TIPO_USO", name: "Tipo de uso do veículo?", isAI: true }
    ]
  },
  {
    id: "menu3_flow",
    name: "Menu 3 - Renovação",
    description: "Cliente escolhe opção 3 - Renovação de seguro existente",
    steps: [
      { key: "MENU3_RENOVACAO_ABERTURA", name: "Tipo de seguro para renovar", isAI: false },
      { key: "MENU3_RENOVACAO_COLETAS", name: "Solicitar identificador (placa/CPF/CNPJ)", isAI: true }
    ]
  },
  {
    id: "menu4_flow",
    name: "Menu 4 - Endosso/Alteração",
    description: "Cliente escolhe opção 4 - Alterações em apólice existente",
    steps: [
      { key: "MENU4_ENDOSSO_ABERTURA", name: "Tipo de alteração", isAI: false },
      { key: "MENU4_ENDOSSO_ITEM", name: "Se alteração de item: veículo ou outro?", isAI: true },
      { key: "MENU4_ENDOSSO_DOCS", name: "Solicitar documentos necessários", isAI: false }
    ]
  },
  {
    id: "menu5_flow",
    name: "Menu 5 - Parcelas/Boletos",
    description: "Cliente escolhe opção 5 - Consulta de parcelas ou 2ª via",
    steps: [
      { key: "MENU5_PARCELAS_ABERTURA", name: "Tipo de seguro para consulta", isAI: false },
      { key: "MENU5_PARCELAS_COLETAS", name: "Solicitar identificador (placa/CPF/CNPJ)", isAI: true }
    ]
  },
  {
    id: "menu6_flow",
    name: "Menu 6 - Sinistros/Assistências",
    description: "Cliente escolhe opção 6 - Abertura de sinistro ou assistência",
    steps: [
      { key: "MENU6_SINISTROS_ABERTURA", name: "Tipo de seguro do sinistro", isAI: false },
      { key: "MENU6_SINISTROS_COLETAS", name: "Solicitar identificador (placa/CPF/CNPJ)", isAI: true }
    ]
  }
];

// React Query Hooks
function useWorkflows() {
  return useQuery<WorkflowTemplate[]>({
    queryKey: ['/api/workflows'],
    queryFn: async () => {
      const response = await fetch('/api/workflows');
      if (!response.ok) throw new Error('Failed to fetch workflows');
      return response.json();
    },
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
      toast({
        title: "Erro ao atualizar workflow",
        description: error.message || "Não foi possível salvar as alterações.",
        variant: "destructive",
      });
    },
  });
}

function useToggleWorkflow() {
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest('POST', `/api/workflows/${id}/toggle`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
    },
    onError: () => {
      toast({
        title: "Erro ao alternar status",
        description: "Não foi possível alterar o status do workflow.",
        variant: "destructive",
      });
    },
  });
}

// Workflow Card Component
function WorkflowCard({ 
  workflow, 
  onEdit 
}: { 
  workflow: WorkflowTemplate; 
  onEdit: (id: string) => void;
}) {
  const toggleMutation = useToggleWorkflow();
  const categoryInfo = workflowCategories[workflow.category as keyof typeof workflowCategories] || workflowCategories.general;
  const Icon = categoryInfo.icon;

  return (
    <Card 
      className={`hover-elevate ${!workflow.isActive ? 'opacity-60' : ''}`}
      data-testid={`card-workflow-${workflow.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${categoryInfo.color}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                {workflow.name}
                {workflow.isAIGenerated && (
                  <Badge variant="secondary" className="gap-1">
                    <Sparkles className="h-3 w-3" />
                    IA
                  </Badge>
                )}
              </CardTitle>
              {workflow.description && (
                <CardDescription className="text-sm">
                  {workflow.description}
                </CardDescription>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <code className="px-1 py-0.5 bg-muted rounded">{workflow.templateKey}</code>
                <span>•</span>
                <span>v{workflow.version}</span>
                <span>•</span>
                <span>{format(new Date(workflow.updatedAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={workflow.isActive}
              onCheckedChange={(checked) => 
                toggleMutation.mutate({ id: workflow.id, isActive: checked })
              }
              disabled={toggleMutation.isPending}
              data-testid={`switch-workflow-${workflow.id}`}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(workflow.id)}
              data-testid={`button-edit-workflow-${workflow.id}`}
            >
              <Edit className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[100px]">
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
            {workflow.content.substring(0, 200)}
            {workflow.content.length > 200 && '...'}
          </div>
        </ScrollArea>
        {workflow.requiredVariables && workflow.requiredVariables.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {workflow.requiredVariables.map((variable) => (
              <Badge key={variable} variant="outline" className="text-xs">
                {variable}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Workflow Editor Modal
function WorkflowEditorModal({ 
  workflowId, 
  isOpen, 
  onClose 
}: { 
  workflowId: string | null; 
  isOpen: boolean; 
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [isAIMode, setIsAIMode] = useState(false);
  const [aiInstructions, setAIInstructions] = useState("");
  const updateMutation = useUpdateWorkflow();

  const { data: workflows } = useWorkflows();
  const workflow = workflows?.find(w => w.id === workflowId);

  useState(() => {
    if (workflow) {
      setContent(workflow.content);
      setIsAIMode(workflow.isAIGenerated || false);
    }
  });

  const handleSave = async () => {
    if (!workflowId) return;
    
    await updateMutation.mutateAsync({
      id: workflowId,
      data: { 
        content,
        isAIGenerated: isAIMode,
        aiInstructions: isAIMode ? aiInstructions : null
      }
    });
    onClose();
  };

  const handleRestoreDefault = () => {
    if (workflow) {
      setContent(workflow.defaultContent);
    }
  };

  if (!workflow) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Editar Workflow: {workflow.name}</DialogTitle>
          <DialogDescription>
            {workflow.description}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="content" className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="content">Conteúdo da Mensagem</TabsTrigger>
            <TabsTrigger value="ai">Configurações IA</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="space-y-4">
            <div className="space-y-2">
              <Label>Template Key</Label>
              <code className="block px-3 py-2 bg-muted rounded text-sm">
                {workflow.templateKey}
              </code>
            </div>

            <div className="space-y-2">
              <Label>Conteúdo da Mensagem</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder="Digite o conteúdo da mensagem..."
                data-testid="textarea-workflow-content"
              />
            </div>

            {workflow.requiredVariables && workflow.requiredVariables.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Variáveis Obrigatórias</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {workflow.requiredVariables.map((variable) => (
                      <Badge key={variable} variant="secondary">
                        {variable}
                      </Badge>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          <TabsContent value="ai" className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Modo IA</Label>
                <Switch
                  checked={isAIMode}
                  onCheckedChange={setIsAIMode}
                  data-testid="switch-ai-mode"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Quando ativado, esta mensagem será gerada dinamicamente pela IA usando as instruções fornecidas.
              </p>
            </div>

            {isAIMode && (
              <div className="space-y-2">
                <Label>Instruções para a IA</Label>
                <Textarea
                  value={aiInstructions}
                  onChange={(e) => setAIInstructions(e.target.value)}
                  rows={8}
                  placeholder="Descreva como a IA deve gerar esta mensagem..."
                  className="text-sm"
                  data-testid="textarea-ai-instructions"
                />
                <Alert>
                  <Sparkles className="h-4 w-4" />
                  <AlertTitle>Dica</AlertTitle>
                  <AlertDescription>
                    Seja específico sobre o tom, contexto e informações que a IA deve incluir na mensagem.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleRestoreDefault}
            data-testid="button-restore-default"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Restaurar Padrão
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            data-testid="button-save-workflow"
          >
            <Save className="h-4 w-4 mr-2" />
            Salvar Alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Message View Dialog Component (with password-protected editing)
function MessageViewDialog({ 
  workflow, 
  isOpen, 
  onClose 
}: { 
  workflow: WorkflowTemplate | null; 
  isOpen: boolean; 
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [isEditMode, setIsEditMode] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [editedName, setEditedName] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savePassword, setSavePassword] = useState("");
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  // Reset states when dialog opens/closes
  const handleClose = () => {
    setIsEditMode(false);
    setPassword("");
    setEditedContent("");
    setEditedName("");
    setEditedDescription("");
    setSavePassword("");
    setShowSaveConfirm(false);
    onClose();
  };

  const validatePassword = async (pwd: string): Promise<boolean> => {
    try {
      setIsValidating(true);
      const response = await apiRequest('POST', '/api/workflows/validate-password', { password: pwd });
      const data = await response.json();
      return data.valid;
    } catch (error: any) {
      console.error('Error validating password:', error);
      toast({
        title: "Erro",
        description: "Erro ao validar senha",
        variant: "destructive"
      });
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const handleUnlockEdit = async () => {
    if (!password) {
      toast({
        title: "Senha obrigatória",
        description: "Digite a senha para editar",
        variant: "destructive"
      });
      return;
    }

    const isValid = await validatePassword(password);
    if (isValid) {
      setIsEditMode(true);
      setEditedContent(workflow?.content || "");
      setEditedName(workflow?.name || "");
      setEditedDescription(workflow?.description || "");
      setIsPasswordDialogOpen(false);
      setPassword("");
      toast({
        title: "Acesso autorizado",
        description: "Você pode editar o template agora",
      });
    } else {
      toast({
        title: "Senha incorreta",
        description: "A senha digitada está incorreta",
        variant: "destructive"
      });
    }
  };

  const handleSave = async () => {
    if (!savePassword) {
      toast({
        title: "Senha obrigatória",
        description: "Digite a senha para confirmar as alterações",
        variant: "destructive"
      });
      return;
    }

    if (!workflow) return;

    try {
      setIsSaving(true);
      await apiRequest('PUT', `/api/workflows/${workflow.id}`, {
        content: editedContent,
        name: editedName,
        description: editedDescription,
        password: savePassword,
        updatedBy: 'admin'
      });

      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      toast({
        title: "Sucesso",
        description: "Template atualizado com sucesso",
      });
      setShowSaveConfirm(false);
      setSavePassword("");
      handleClose();
    } catch (error: any) {
      console.error('Error saving workflow:', error);
      toast({
        title: "Erro ao salvar",
        description: error?.message || "Verifique a senha e tente novamente",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!workflow) return null;

  return (
    <>
      {/* Main Dialog */}
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg max-h-[85vh] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4">
            {isEditMode ? (
              <div className="space-y-2">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="text-lg font-medium"
                  data-testid="input-workflow-name"
                />
                <p className="text-xs text-muted-foreground">{workflow.templateKey}</p>
              </div>
            ) : (
              <>
                <DialogTitle className="text-lg font-medium">
                  {workflow.name}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {workflow.templateKey}
                </DialogDescription>
              </>
            )}
          </DialogHeader>

          <ScrollArea className="h-[450px] px-6 scrollbar-thin">
            <div className="space-y-4 pb-4">
              {isEditMode ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground font-medium">Quando é enviada:</Label>
                    <Textarea
                      value={editedDescription}
                      readOnly
                      className="text-sm min-h-[60px] bg-muted/50 cursor-not-allowed"
                      data-testid="textarea-workflow-description"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground font-medium">Conteúdo da Mensagem</Label>
                    <Textarea
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      className="text-sm font-mono min-h-[250px]"
                      data-testid="textarea-workflow-content"
                    />
                  </div>
                </>
              ) : (
                <>
                  {workflow.description && (
                    <div className="p-3 bg-muted/50 rounded-md">
                      <p className="text-xs text-muted-foreground mb-1 font-medium">Quando é enviada:</p>
                      <p className="text-sm">{workflow.description}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Conteúdo da Mensagem</p>
                    <div className="p-3 bg-muted/30 rounded-md">
                      <pre className="text-sm whitespace-pre-wrap font-mono text-foreground/90">
                        {workflow.content}
                      </pre>
                    </div>
                  </div>
                </>
              )}

              {workflow.requiredVariables && workflow.requiredVariables.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Variáveis dinâmicas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {workflow.requiredVariables.map((variable) => (
                      <Badge key={variable} variant="outline" className="text-xs h-6">
                        {variable}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="px-6 py-3 border-t bg-muted/20">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <Badge variant={workflow.isActive ? "default" : "secondary"} className="h-5 text-xs">
                  {workflow.isActive ? "Ativo" : "Inativo"}
                </Badge>
                <span className="text-muted-foreground">
                  v{workflow.version} • {format(new Date(workflow.updatedAt), "dd/MM HH:mm", { locale: ptBR })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isEditMode ? (
                  <>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setIsEditMode(false)}
                      className="h-7 text-xs"
                      data-testid="button-cancel-edit"
                    >
                      Cancelar
                    </Button>
                    <Button 
                      variant="default" 
                      size="sm" 
                      onClick={() => setShowSaveConfirm(true)}
                      className="h-7 text-xs"
                      data-testid="button-save-workflow"
                    >
                      <Save className="h-3 w-3 mr-1" />
                      Salvar
                    </Button>
                  </>
                ) : (
                  <>
                    <Button 
                      variant="default" 
                      size="sm" 
                      onClick={() => setIsPasswordDialogOpen(true)}
                      className="h-7 text-xs"
                      data-testid="button-edit-workflow"
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Editar
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleClose}
                      className="h-7 text-xs"
                      data-testid="button-close-workflow"
                    >
                      Fechar
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Password Dialog for Unlocking Edit */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Autenticação Necessária
            </DialogTitle>
            <DialogDescription>
              Digite a senha para editar este template
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlockEdit()}
                placeholder="Digite a senha"
                data-testid="input-unlock-password"
                autoFocus
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsPasswordDialogOpen(false);
                setPassword("");
              }}
              data-testid="button-cancel-password"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleUnlockEdit}
              disabled={isValidating || !password}
              data-testid="button-confirm-password"
            >
              {isValidating ? "Validando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Confirmation Dialog for Saving */}
      <Dialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Confirmar Alterações
            </DialogTitle>
            <DialogDescription>
              Digite a senha novamente para confirmar as alterações
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="save-password">Senha</Label>
              <Input
                id="save-password"
                type="password"
                value={savePassword}
                onChange={(e) => setSavePassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="Digite a senha para confirmar"
                data-testid="input-save-password"
                autoFocus
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowSaveConfirm(false);
                setSavePassword("");
              }}
              data-testid="button-cancel-save"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !savePassword}
              data-testid="button-confirm-save"
            >
              {isSaving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Flow Visualization Component
function FlowVisualization({ 
  workflows, 
  onViewMessage 
}: { 
  workflows: WorkflowTemplate[];
  onViewMessage: (workflow: WorkflowTemplate) => void;
}) {
  return (
    <div className="space-y-4">
      {workflowFlow.map((flow) => (
        <Card key={flow.id} data-testid={`card-flow-${flow.id}`}>
          <CardHeader>
            <CardTitle className="text-base">{flow.name}</CardTitle>
            <CardDescription>{flow.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {flow.steps.map((step, index) => {
                const workflow = workflows.find(w => w.templateKey === step.key);
                return (
                  <div key={step.key} className="flex flex-col sm:flex-row gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="flex items-center justify-center w-6 h-6 flex-shrink-0 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        {index + 1}
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 flex-1 min-w-0">
                        <span className="text-sm font-medium truncate">{step.name}</span>
                        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                          {step.isAI && (
                            <Badge variant="secondary" className="gap-1 text-xs">
                              <Brain className="h-3 w-3" />
                              IA
                            </Badge>
                          )}
                          <code className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-muted rounded whitespace-nowrap">
                            {step.key}
                          </code>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap sm:ml-auto pl-8 sm:pl-0">
                      {workflow && (
                        <>
                          <Badge variant={workflow.isActive ? "default" : "secondary"} className="text-xs">
                            {workflow.isActive ? "Ativo" : "Inativo"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewMessage(workflow)}
                            data-testid={`button-view-message-${step.key}`}
                            className="h-8 text-xs"
                          >
                            <Eye className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
                            <span className="hidden sm:inline">Ver Mensagem</span>
                          </Button>
                        </>
                      )}
                      {!workflow && (
                        <span className="text-xs text-muted-foreground italic">
                          Não encontrado
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function WorkflowsRefactored() {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [viewingWorkflow, setViewingWorkflow] = useState<WorkflowTemplate | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  const { data: workflows = [], isLoading, error } = useWorkflows();
  
  // Buscar configurações para mostrar tempo de buffer real
  const { data: settings } = useQuery<{ bufferTimeoutSeconds: number }>({
    queryKey: ['/api/settings'],
  });

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((workflow) => {
      const matchesSearch = !searchTerm || 
        workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        workflow.templateKey.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (workflow.description && workflow.description.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCategory = categoryFilter === "all" || workflow.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [workflows, searchTerm, categoryFilter]);

  const handleEdit = (id: string) => {
    setEditingWorkflowId(id);
    setIsEditorOpen(true);
  };

  const handleViewMessage = (workflow: WorkflowTemplate) => {
    setViewingWorkflow(workflow);
    setIsViewDialogOpen(true);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <Alert className="max-w-lg">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erro ao carregar workflows</AlertTitle>
          <AlertDescription>
            Não foi possível carregar os workflows. Por favor, tente novamente.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 sm:p-6 border-b bg-card">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 sm:h-6 sm:w-6" />
            <span className="truncate">Gerenciamento de Workflows</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Configure mensagens automáticas e fluxos de conversação do chatbot
          </p>
        </div>
      </div>

      {/* Content with Tabs */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="flows" className="flex flex-col h-full">
          <div className="px-4 sm:px-6 pt-4">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="flows" data-testid="tab-flows" className="text-xs sm:text-sm">
                <GitBranch className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                <span className="hidden xs:inline">Fluxos de </span>Mensagens
              </TabsTrigger>
              <TabsTrigger value="guide" data-testid="tab-guide" className="text-xs sm:text-sm">
                <Info className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                Como Funciona
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="flows" className="flex-1 overflow-auto px-4 sm:px-6 py-4 mt-0">
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-48 w-full" />
                ))}
              </div>
            ) : (
              <FlowVisualization 
                workflows={workflows} 
                onViewMessage={handleViewMessage}
              />
            )}
          </TabsContent>

          <TabsContent value="guide" className="flex-1 overflow-auto px-4 sm:px-6 py-4 mt-0">
            <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
              {/* Fluxo de Mensagens */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    Fluxo de Mensagens
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Como o sistema processa mensagens do WhatsApp
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-4">
                    <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
                      <Phone className="h-8 w-8 mb-2 text-orange-600" />
                      <p className="font-medium text-sm">Cliente envia</p>
                      <p className="text-xs text-muted-foreground mt-1">Mensagem chega pelo WhatsApp</p>
                    </div>
                    <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
                      <Clock className="h-8 w-8 mb-2 text-orange-600" />
                      <p className="font-medium text-sm">Sistema aguarda</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Agrupa mensagens por 3-{settings?.bufferTimeoutSeconds || 30}s
                      </p>
                    </div>
                    <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
                      <Brain className="h-8 w-8 mb-2 text-purple-600" />
                      <p className="font-medium text-sm">IA processa</p>
                      <p className="text-xs text-muted-foreground mt-1">Entende intenção e extrai dados</p>
                    </div>
                    <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
                      <CheckCircle className="h-8 w-8 mb-2 text-green-600" />
                      <p className="font-medium text-sm">Bot responde</p>
                      <p className="text-xs text-muted-foreground mt-1">Envia mensagem apropriada</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Variáveis de Fluxo */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <Database className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    O que o Sistema Armazena
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Principais informações guardadas durante a conversa
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2">
                    <div className="p-4 rounded-lg border">
                      <div className="flex items-center gap-2 mb-2">
                        <GitBranch className="h-5 w-5 text-orange-600" />
                        <p className="font-semibold">Etapa Atual</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Em qual fase da conversa o cliente está: Selecionando menu, Preenchendo dados pessoais, Enviando documentos, etc.
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="h-5 w-5 text-green-600" />
                        <p className="font-semibold">Dados Coletados</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Informações fornecidas: tipo de seguro escolhido, dados pessoais (nome, CPF), dados do veículo (placa, modelo, ano).
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-5 w-5 text-orange-600" />
                        <p className="font-semibold">Status de Atendimento</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Indica se conversa está com bot automático ou foi transferida para atendente humano.
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border">
                      <div className="flex items-center gap-2 mb-2">
                        <Hash className="h-5 w-5 text-purple-600" />
                        <p className="font-semibold">Escolhas do Menu</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Opção selecionada pelo cliente: 1=Seguros Novos, 2=Autorio, 3=Renovação, 4=Endosso, 5=Parcelas, 6=Sinistros.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sistema de Espera */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    Sistema de Espera Inteligente
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Por que o bot aguarda antes de responder
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-500/10">
                    <Zap className="h-5 w-5 text-orange-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Primeira mensagem: 3 segundos</p>
                      <p className="text-xs text-muted-foreground">Resposta rápida para novo contato</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-500/10">
                    <Clock className="h-5 w-5 text-orange-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">
                        Mensagens seguintes: {settings?.bufferTimeoutSeconds || 30} segundos
                      </p>
                      <p className="text-xs text-muted-foreground">Cliente pode enviar múltiplas mensagens sem interrupção</p>
                    </div>
                  </div>
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      O sistema aguarda para não interromper o cliente enquanto ele digita. Todas as mensagens são analisadas juntas para melhor compreensão.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              {/* Etapas da Conversa */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <PlayCircle className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    Etapas da Conversa
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Sequência do atendimento automático
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-sm font-semibold text-orange-600">1</div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Início → Boas-vindas e apresentação do menu</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-sm font-semibold text-green-600">2</div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Seleção do Menu → Cliente escolhe opção (1 a 6)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-sm font-semibold text-purple-600">3</div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Coleta de Dados → Sistema pergunta informações necessárias</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-sm font-semibold text-orange-600">4</div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Documentos → Aguardando envio de fotos ou arquivos</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Transferência Humana */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <Users className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    Transferência para Humano
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Quando o bot passa para atendente
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <p className="font-medium text-sm">O bot transfere automaticamente quando:</p>
                    <div className="grid gap-2">
                      <div className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                        <span>Cliente pede "quero falar com atendente"</span>
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                        <span>Cliente escolhe: Renovação, Endosso, Parcelas ou Sinistros</span>
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                        <span>Ocorre erro técnico no processamento</span>
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                        <span>Atendente envia mensagem manual</span>
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <Alert>
                    <Shield className="h-4 w-4" />
                    <AlertTitle className="text-sm font-semibold">Bot para permanentemente</AlertTitle>
                    <AlertDescription className="text-sm">
                      Após transferir nos casos acima, o bot para de responder permanentemente. Apenas atendentes humanos poderão continuar a conversa.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              </Card>

              {/* Como a IA Ajuda */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <Brain className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    Como a IA Ajuda
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">
                    Inteligência artificial no atendimento
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                    <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <p className="font-semibold text-sm mb-1">Entende intenções</p>
                      <p className="text-xs text-muted-foreground">
                        "quero fazer seguro" → Opção 1<br/>
                        "preciso renovar" → Opção 3
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <p className="font-semibold text-sm mb-1">Extrai dados</p>
                      <p className="text-xs text-muted-foreground">
                        "João Silva, CPF 123..." → Estrutura automaticamente nome, CPF, etc.
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <p className="font-semibold text-sm mb-1">Interpreta sim/não</p>
                      <p className="text-xs text-muted-foreground">
                        "pode sim", "claro" → Verdadeiro<br/>
                        "não", "negativo" → Falso
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <p className="font-semibold text-sm mb-1">Respostas dinâmicas</p>
                      <p className="text-xs text-muted-foreground">
                        Gera respostas personalizadas quando necessário
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Editor Modal */}
      <WorkflowEditorModal
        workflowId={editingWorkflowId}
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
      />

      {/* Message View Dialog */}
      <MessageViewDialog
        workflow={viewingWorkflow}
        isOpen={isViewDialogOpen}
        onClose={() => setIsViewDialogOpen(false)}
      />
    </div>
  );
}