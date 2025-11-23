import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, RefreshCw, Smartphone, Trash2, MessageSquare, Clock, Settings, Edit } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Instance } from "@shared/schema";
import { WahaConfigDialog } from "@/components/waha-config-dialog";

export default function Instances() {
  const { toast } = useToast();
  const [newInstanceName, setNewInstanceName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instanceToDelete, setInstanceToDelete] = useState<string | null>(null);
  const [wahaConfigDialogOpen, setWahaConfigDialogOpen] = useState(false);
  const [instanceToConfig, setInstanceToConfig] = useState<Instance | null>(null);

  const { data: instances, isLoading } = useQuery<Instance[]>({
    queryKey: ['/api/instancias'],
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest('POST', '/api/instancias', { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
      toast({
        title: "Instância criada",
        description: "A instância foi criada com sucesso.",
      });
      setNewInstanceName("");
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao criar instância",
        description: error.message || "Falha ao criar instância",
        variant: "destructive",
      });
    },
  });

  const fetchQrCode = async (instanceName: string) => {
    try {
      const response = await fetch(`/api/instancias/${instanceName}/qr`);
      if (!response.ok) {
        throw new Error('Falha ao obter QR code');
      }
      const data = await response.json();
      setQrCode(data.qr || null);
    } catch (error) {
      console.error('Error fetching QR code:', error);
      toast({
        title: "Erro ao obter QR code",
        description: "Não foi possível obter o QR code. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const startInstance = async (instanceName: string) => {
    try {
      const response = await fetch(`/api/instancias/${instanceName}/start`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error('Falha ao iniciar instância');
      }
      
      toast({
        title: "Instância iniciada",
        description: "A instância foi iniciada com sucesso.",
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
    } catch (error) {
      console.error('Error starting instance:', error);
      toast({
        title: "Erro ao iniciar instância",
        description: "Não foi possível iniciar a instância. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const restartInstance = async (instanceName: string) => {
    try {
      const response = await fetch(`/api/instancias/${instanceName}/restart`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error('Falha ao reiniciar instância');
      }
      
      toast({
        title: "Instância reiniciada",
        description: "A instância foi reiniciada com sucesso. Aguarde o QR code.",
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
    } catch (error) {
      console.error('Error restarting instance:', error);
      toast({
        title: "Erro ao reiniciar instância",
        description: "Não foi possível reiniciar a instância. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleShowQr = async (instanceName: string) => {
    setSelectedInstance(instanceName);
    setQrDialogOpen(true);
    setQrCode(null);
    await fetchQrCode(instanceName);
  };

  const handleDeleteClick = (instanceName: string) => {
    setInstanceToDelete(instanceName);
    setDeleteDialogOpen(true);
  };

  const handleConfigClick = (instance: Instance) => {
    setInstanceToConfig(instance);
    setWahaConfigDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!instanceToDelete) return;

    try {
      const response = await fetch(`/api/instancias/${instanceToDelete}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error('Falha ao excluir instância');
      }
      
      toast({
        title: "Instância excluída",
        description: "A instância foi excluída com sucesso.",
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
      setDeleteDialogOpen(false);
      setInstanceToDelete(null);
    } catch (error) {
      console.error('Error deleting instance:', error);
      toast({
        title: "Erro ao excluir instância",
        description: "Não foi possível excluir a instância. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleToggleChatbot = async (instanceName: string, enabled: boolean) => {
    try {
      const response = await apiRequest('PATCH', `/api/instancias/${instanceName}/toggles`, {
        chatbotEnabled: enabled
      });
      
      if (!response) {
        throw new Error('Falha ao atualizar chatbot');
      }
      
      toast({
        title: enabled ? "Chatbot ativado" : "Chatbot desativado",
        description: `O chatbot foi ${enabled ? 'ativado' : 'desativado'} para esta instância.`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
    } catch (error) {
      console.error('Error toggling chatbot:', error);
      toast({
        title: "Erro ao atualizar chatbot",
        description: "Não foi possível atualizar o chatbot. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleToggleFollowup = async (instanceName: string, enabled: boolean) => {
    try {
      const response = await apiRequest('PATCH', `/api/instancias/${instanceName}/toggles`, {
        followupEnabled: enabled
      });
      
      if (!response) {
        throw new Error('Falha ao atualizar follow-up');
      }
      
      toast({
        title: enabled ? "Follow-up ativado" : "Follow-up desativado",
        description: `O follow-up foi ${enabled ? 'ativado' : 'desativado'} para esta instância.`,
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
    } catch (error) {
      console.error('Error toggling followup:', error);
      toast({
        title: "Erro ao atualizar follow-up",
        description: "Não foi possível atualizar o follow-up. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleCreate = () => {
    if (!newInstanceName.trim()) {
      toast({
        title: "Nome inválido",
        description: "Por favor, insira um nome para a instância.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(newInstanceName.trim());
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      WORKING: { label: "Conectado", variant: "default" },
      SCAN_QR_CODE: { label: "Aguardando QR", variant: "secondary" },
      SCAN_QR: { label: "Aguardando QR", variant: "secondary" },
      STARTING: { label: "Iniciando", variant: "outline" },
      STOPPED: { label: "Parado", variant: "destructive" },
      FAILED: { label: "Falha", variant: "destructive" },
    };

    const statusInfo = statusMap[status] || { label: status, variant: "outline" as const };
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    let statusCheckId: NodeJS.Timeout;
    
    if (qrDialogOpen && selectedInstance) {
      intervalId = setInterval(async () => {
        await fetchQrCode(selectedInstance);
      }, 5000);

      statusCheckId = setInterval(async () => {
        try {
          const response = await fetch(`/api/instancias/${selectedInstance}/status`);
          if (response.ok) {
            const data = await response.json();
            
            if (data.status === 'WORKING') {
              setQrDialogOpen(false);
              toast({
                title: "WhatsApp conectado!",
                description: "Sua instância foi conectada com sucesso.",
              });
              queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
            }
          }
        } catch (error) {
          console.error('Error checking status:', error);
        }
      }, 3000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (statusCheckId) {
        clearInterval(statusCheckId);
      }
    };
  }, [qrDialogOpen, selectedInstance]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-4 sm:p-6 border-b space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold" data-testid="text-page-title">Instâncias WhatsApp</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Gerencie suas conexões WhatsApp via WAHA
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)} data-testid="button-create-instance" className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" />
            Nova Instância
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Nova Instância</DialogTitle>
                <DialogDescription>
                  Insira um nome único para a nova instância WhatsApp
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="instance-name">Nome da Instância</Label>
                  <Input
                    id="instance-name"
                    data-testid="input-instance-name"
                    placeholder="Ex: principal, suporte, vendas"
                    value={newInstanceName}
                    onChange={(e) => setNewInstanceName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleCreate();
                      }
                    }}
                  />
                </div>
                <Button
                  data-testid="button-confirm-create"
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="w-full"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Criando...
                    </>
                  ) : (
                    "Criar Instância"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !instances || instances.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <Smartphone className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhuma instância criada</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Crie sua primeira instância WhatsApp para começar
              </p>
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[20%]">Nome</TableHead>
                    <TableHead className="w-[15%]">Status</TableHead>
                    <TableHead className="w-[15%]">Chatbot</TableHead>
                    <TableHead className="w-[15%]">Follow-up</TableHead>
                    <TableHead className="w-[15%]">Conexão</TableHead>
                    <TableHead className="w-[20%] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instances.map((instance) => (
                    <TableRow key={instance.id} data-testid={`row-instance-${instance.name}`}>
                      <TableCell className="font-medium" data-testid={`text-instance-name-${instance.name}`}>
                        <div className="flex flex-col">
                          <span>{instance.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(instance.createdAt).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell data-testid={`status-${instance.name}`}>
                        {getStatusBadge(instance.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`chatbot-${instance.name}`}
                            data-testid={`switch-chatbot-${instance.name}`}
                            checked={instance.chatbotEnabled}
                            onCheckedChange={(checked) => handleToggleChatbot(instance.name, checked)}
                          />
                          <Badge
                            variant={instance.chatbotEnabled ? "default" : "secondary"}
                            data-testid={`badge-chatbot-${instance.name}`}
                          >
                            {instance.chatbotEnabled ? "Ativo" : "Inativo"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`followup-${instance.name}`}
                            data-testid={`switch-followup-${instance.name}`}
                            checked={instance.followupEnabled}
                            onCheckedChange={(checked) => handleToggleFollowup(instance.name, checked)}
                          />
                          <Badge
                            variant={instance.followupEnabled ? "default" : "secondary"}
                            data-testid={`badge-followup-${instance.name}`}
                          >
                            {instance.followupEnabled ? "Ativo" : "Inativo"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {instance.status === 'STOPPED' && (
                          <Button
                            data-testid={`button-start-${instance.name}`}
                            variant="outline"
                            size="sm"
                            onClick={() => startInstance(instance.name)}
                          >
                            <Smartphone className="w-3 h-3 mr-1" />
                            Iniciar
                          </Button>
                        )}

                        {instance.status === 'FAILED' && (
                          <Button
                            data-testid={`button-restart-${instance.name}`}
                            variant="outline"
                            size="sm"
                            onClick={() => restartInstance(instance.name)}
                          >
                            <RefreshCw className="w-3 h-3 mr-1" />
                            Tentar Novamente
                          </Button>
                        )}
                      
                        {(instance.status === 'SCAN_QR_CODE' || instance.status === 'SCAN_QR' || instance.status === 'STARTING') && (
                          <Button
                            data-testid={`button-show-qr-${instance.name}`}
                            variant="outline"
                            size="sm"
                            onClick={() => handleShowQr(instance.name)}
                          >
                            <Smartphone className="w-3 h-3 mr-1" />
                            Conectar
                          </Button>
                        )}

                        {instance.status === 'WORKING' && (
                          <Badge variant="default">
                            <Smartphone className="w-3 h-3 mr-1" />
                            Conectado
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleConfigClick(instance)}
                            data-testid={`button-config-${instance.name}`}
                          >
                            <Settings className="h-4 w-4" />
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-delete-${instance.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir instância?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja excluir a instância "{instance.name}"?
                                  Isso removerá permanentemente a sessão do WhatsApp. Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel data-testid="button-cancel-delete">
                                  Cancelar
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => {
                                    setInstanceToDelete(instance.name);
                                    handleDeleteConfirm();
                                  }}
                                  data-testid={`button-confirm-delete-${instance.name}`}
                                >
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conectar WhatsApp</DialogTitle>
            <DialogDescription>
              Instância: {selectedInstance}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-6 space-y-4">
            {qrCode ? (
              <>
                <div className="bg-white p-4 rounded-lg">
                  <img
                    src={qrCode}
                    alt="QR Code WhatsApp"
                    className="w-64 h-64"
                    data-testid="img-qr-code"
                  />
                </div>
              </>
            ) : (
              <div className="w-64 h-64 border-2 border-dashed rounded-lg flex items-center justify-center bg-muted/50">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Carregando QR Code...</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {instanceToConfig && (
        <WahaConfigDialog
          open={wahaConfigDialogOpen}
          onOpenChange={setWahaConfigDialogOpen}
          instanceName={instanceToConfig.name}
          initialWebhooks={instanceToConfig.webhooks || []}
          initialEvents={instanceToConfig.events || []}
          initialCustomHeaders={(instanceToConfig.customHeaders as Record<string, string> | null | undefined) ?? {}}
        />
      )}
    </div>
  );
}
