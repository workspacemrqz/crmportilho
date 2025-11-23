import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, RefreshCw, Smartphone, Trash2, MessageSquare, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from "@/components/ui/alert-dialog";
import type { Instance } from "@shared/schema";

export default function Instances() {
  const { toast } = useToast();
  const [newInstanceName, setNewInstanceName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instanceToDelete, setInstanceToDelete] = useState<string | null>(null);

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

  const refreshStatus = async (instanceName: string) => {
    try {
      await fetch(`/api/instancias/${instanceName}/status`);
      queryClient.invalidateQueries({ queryKey: ['/api/instancias'] });
    } catch (error) {
      console.error('Error refreshing status:', error);
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
      // Set up interval to refresh QR code every 5 seconds
      intervalId = setInterval(async () => {
        await fetchQrCode(selectedInstance);
      }, 5000);

      // Check instance status every 3 seconds to detect when connected
      statusCheckId = setInterval(async () => {
        try {
          const response = await fetch(`/api/instancias/${selectedInstance}/status`);
          if (response.ok) {
            const data = await response.json();
            
            // If status is WORKING (connected), close modal and show success
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Instâncias WhatsApp</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie suas conexões WhatsApp via WAHA
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-instance">
              <Plus className="w-4 h-4 mr-2" />
              Nova Instância
            </Button>
          </DialogTrigger>
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
      </div>

      {!instances || instances.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Smartphone className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhuma instância criada</h3>
            <p className="text-muted-foreground text-center mb-4">
              Crie sua primeira instância WhatsApp para começar
            </p>
            <Button
              data-testid="button-create-first-instance"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Criar Primeira Instância
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {instances.map((instance) => (
            <Card key={instance.id} data-testid={`card-instance-${instance.name}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{instance.name}</CardTitle>
                  {getStatusBadge(instance.status)}
                </div>
                <CardDescription>
                  Criado em {new Date(instance.createdAt).toLocaleDateString('pt-BR')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-muted-foreground" />
                      <Label htmlFor={`chatbot-${instance.name}`} className="text-sm font-medium">
                        Chatbot
                      </Label>
                    </div>
                    <Switch
                      id={`chatbot-${instance.name}`}
                      data-testid={`switch-chatbot-${instance.name}`}
                      checked={instance.chatbotEnabled}
                      onCheckedChange={(checked) => handleToggleChatbot(instance.name, checked)}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <Label htmlFor={`followup-${instance.name}`} className="text-sm font-medium">
                        Follow-up
                      </Label>
                    </div>
                    <Switch
                      id={`followup-${instance.name}`}
                      data-testid={`switch-followup-${instance.name}`}
                      checked={instance.followupEnabled}
                      onCheckedChange={(checked) => handleToggleFollowup(instance.name, checked)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  {instance.status === 'STOPPED' && (
                    <Button
                      data-testid={`button-start-${instance.name}`}
                      variant="default"
                      className="w-full"
                      onClick={() => startInstance(instance.name)}
                    >
                      <Smartphone className="w-4 h-4 mr-2" />
                      Iniciar Instância
                    </Button>
                  )}

                  {instance.status === 'FAILED' && (
                    <Button
                      data-testid={`button-restart-${instance.name}`}
                      variant="default"
                      className="w-full"
                      onClick={() => restartInstance(instance.name)}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Tentar Novamente
                    </Button>
                  )}
                
                {(instance.status === 'SCAN_QR_CODE' || instance.status === 'SCAN_QR' || instance.status === 'STARTING') && (
                  <Button
                    data-testid={`button-show-qr-${instance.name}`}
                    variant="default"
                    className="w-full"
                    onClick={() => handleShowQr(instance.name)}
                  >
                    <Smartphone className="w-4 h-4 mr-2" />
                    Conectar WhatsApp
                  </Button>
                )}

                  <Button
                    data-testid={`button-delete-${instance.name}`}
                    variant="destructive"
                    className="w-full"
                    onClick={() => handleDeleteClick(instance.name)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Excluir Instância
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
                <div className="text-center space-y-2">
                  <p className="text-sm font-medium">
                    Como conectar:
                  </p>
                  <ol className="text-sm text-muted-foreground space-y-1 text-left">
                    <li>1. Abra o WhatsApp no seu celular</li>
                    <li>2. Toque em <strong>Mais opções</strong> ou <strong>Configurações</strong></li>
                    <li>3. Toque em <strong>Aparelhos conectados</strong></li>
                    <li>4. Toque em <strong>Conectar um aparelho</strong></li>
                    <li>5. Aponte seu celular para esta tela para escanear o código</li>
                  </ol>
                  <p className="text-xs text-muted-foreground mt-4">
                    O QR code é atualizado automaticamente a cada 5 segundos
                  </p>
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Isso excluirá permanentemente a instância{" "}
              <strong>{instanceToDelete}</strong> e removerá a sessão do WhatsApp.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete"
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
