import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, RefreshCw, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Instance } from "@shared/schema";

export default function Instances() {
  const { toast } = useToast();
  const [newInstanceName, setNewInstanceName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);

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

  const handleShowQr = async (instanceName: string) => {
    setSelectedInstance(instanceName);
    setQrDialogOpen(true);
    setQrCode(null);
    await fetchQrCode(instanceName);
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
    
    if (qrDialogOpen && selectedInstance) {
      intervalId = setInterval(async () => {
        await fetchQrCode(selectedInstance);
        await refreshStatus(selectedInstance);
      }, 5000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
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
              <CardContent className="space-y-2">
                {instance.status === 'SCAN_QR' && (
                  <Button
                    data-testid={`button-show-qr-${instance.name}`}
                    variant="default"
                    className="w-full"
                    onClick={() => handleShowQr(instance.name)}
                  >
                    <Smartphone className="w-4 h-4 mr-2" />
                    Exibir QR Code
                  </Button>
                )}
                
                <Button
                  data-testid={`button-refresh-${instance.name}`}
                  variant="outline"
                  className="w-full"
                  onClick={() => refreshStatus(instance.name)}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Atualizar Status
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>QR Code - {selectedInstance}</DialogTitle>
            <DialogDescription>
              Escaneie o QR code com seu WhatsApp para conectar
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-6">
            {qrCode ? (
              <img
                src={qrCode}
                alt="QR Code"
                className="w-64 h-64 border rounded-md"
                data-testid="img-qr-code"
              />
            ) : (
              <div className="w-64 h-64 border rounded-md flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-4 text-center">
              O QR code será atualizado automaticamente
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
