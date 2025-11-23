import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Plus, Edit, Trash2, Clock, Loader2, MessageSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type FollowupMessage = {
  id: string;
  name: string;
  message: string;
  delayMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const followupMessageSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  message: z.string().min(1, "Mensagem é obrigatória"),
  delayMinutes: z.coerce.number().min(1, "Tempo de espera deve ser maior que 0"),
  isActive: z.boolean().default(true),
});

type FollowupMessageForm = z.infer<typeof followupMessageSchema>;

// Opções predefinidas de tempo
const TIME_PRESETS = [
  { label: "4 horas", minutes: 240, description: "Ideal para resposta rápida" },
  { label: "8 horas", minutes: 480, description: "Padrão comercial" },
  { label: "12 horas", minutes: 720, description: "Meio dia útil" },
  { label: "24 horas", minutes: 1440, description: "Um dia completo" },
  { label: "48 horas", minutes: 2880, description: "Dois dias" },
];

export default function FollowupPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<FollowupMessage | null>(null);

  const { data: messages = [], isLoading } = useQuery<FollowupMessage[]>({
    queryKey: ['/api/followup-messages'],
  });

  const form = useForm<FollowupMessageForm>({
    resolver: zodResolver(followupMessageSchema),
    defaultValues: {
      name: "",
      message: "",
      delayMinutes: 480,
      isActive: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FollowupMessageForm) => {
      return await apiRequest('POST', '/api/followup-messages', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/followup-messages'] });
      toast({
        title: "Mensagem criada",
        description: "A mensagem de follow-up foi criada com sucesso.",
      });
      handleCloseDialog();
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível criar a mensagem.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<FollowupMessageForm> }) => {
      return await apiRequest('PATCH', `/api/followup-messages/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/followup-messages'] });
      toast({
        title: "Mensagem atualizada",
        description: "A mensagem de follow-up foi atualizada com sucesso.",
      });
      handleCloseDialog();
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível atualizar a mensagem.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/followup-messages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/followup-messages'] });
      toast({
        title: "Mensagem excluída",
        description: "A mensagem de follow-up foi excluída com sucesso.",
      });
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível excluir a mensagem.",
        variant: "destructive",
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return await apiRequest('PATCH', `/api/followup-messages/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/followup-messages'] });
      toast({
        title: "Status atualizado",
        description: "O status da mensagem foi atualizado.",
      });
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o status.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FollowupMessageForm) => {
    if (editingMessage) {
      updateMutation.mutate({ id: editingMessage.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleOpenCreate = () => {
    setEditingMessage(null);
    form.reset({
      name: "",
      message: "",
      delayMinutes: 480,
      isActive: true,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (message: FollowupMessage) => {
    setEditingMessage(message);
    form.reset({
      name: message.name,
      message: message.message,
      delayMinutes: message.delayMinutes,
      isActive: message.isActive,
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMessage(null);
    form.reset();
  };

  const formatDelay = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours} hora${hours !== 1 ? 's' : ''}`;
    }
    return `${hours}h ${remainingMinutes}min`;
  };

  // Watch the current delay value to show preview
  const currentDelay = form.watch("delayMinutes");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-4 sm:p-6 border-b space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold" data-testid="text-page-title">Follow-up Automático</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Configure mensagens automáticas enviadas quando leads ficam sem responder
            </p>
          </div>
          <Button onClick={handleOpenCreate} data-testid="button-create-followup" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Nova Mensagem
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="w-[95vw] max-w-[600px] max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingMessage ? "Editar Follow-up" : "Novo Follow-up Automático"}
                </DialogTitle>
                <DialogDescription>
                  {editingMessage 
                    ? "Ajuste a mensagem que será enviada automaticamente"
                    : "Configure uma mensagem para reengajar leads que pararam de responder"
                  }
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  {/* Nome da mensagem */}
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome de identificação</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Ex: Lembrete após 8 horas"
                            data-testid="input-followup-name"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Um nome para você identificar esta mensagem no sistema
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Tempo de espera com botões predefinidos */}
                  <FormField
                    control={form.control}
                    name="delayMinutes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quando enviar a mensagem?</FormLabel>
                        
                        {/* Botões de seleção rápida */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                          {TIME_PRESETS.map((preset) => (
                            <Button
                              key={preset.minutes}
                              type="button"
                              variant={field.value === preset.minutes ? "default" : "outline"}
                              size="sm"
                              onClick={() => field.onChange(preset.minutes)}
                              className="h-auto py-2 px-3 flex flex-col items-start gap-0.5"
                              data-testid={`button-preset-${preset.minutes}`}
                            >
                              <span className="font-semibold text-sm">{preset.label}</span>
                              <span className="text-xs opacity-80">{preset.description}</span>
                            </Button>
                          ))}
                        </div>

                        {/* Campo de entrada manual */}
                        <div className="space-y-2">
                          <Label className="text-sm text-muted-foreground">Ou defina um tempo personalizado:</Label>
                          <div className="flex gap-2 items-center">
                            <FormControl>
                              <Input
                                type="number"
                                min="1"
                                placeholder="480"
                                className="flex-1"
                                data-testid="input-followup-delay"
                                {...field}
                              />
                            </FormControl>
                            <span className="text-sm text-muted-foreground whitespace-nowrap">minutos</span>
                          </div>
                          
                          {/* Preview visual do tempo */}
                          {currentDelay > 0 && (
                            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">
                                Mensagem será enviada após <strong>{formatDelay(currentDelay)}</strong> sem resposta
                              </span>
                            </div>
                          )}
                        </div>
                        
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Mensagem de follow-up */}
                  <FormField
                    control={form.control}
                    name="message"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mensagem que será enviada</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Exemplo: Olá {nome}! Notei que você não respondeu nossa última mensagem. Posso ajudar com mais alguma informação sobre o seguro?"
                            className="min-h-[100px] resize-none"
                            data-testid="input-followup-message"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Tags disponíveis: <code className="px-1 py-0.5 rounded bg-muted text-xs">{"{nome}"}</code> (primeiro nome), <code className="px-1 py-0.5 rounded bg-muted text-xs">[DD/MM/AAAA]</code> (data atual), <code className="px-1 py-0.5 rounded bg-muted text-xs">[NÚMERO_DO_PROTOCOLO]</code> (protocolo do cliente). Seja amigável e ofereça ajuda.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Status ativo/inativo */}
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Ativar envio automático</FormLabel>
                          <FormDescription className="text-sm">
                            A mensagem será enviada automaticamente no tempo configurado
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-followup-active"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCloseDialog}
                      data-testid="button-cancel"
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save-followup"
                    >
                      {(createMutation.isPending || updateMutation.isPending) && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {editingMessage ? "Salvar" : "Criar Follow-up"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhuma mensagem configurada</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Crie sua primeira mensagem de follow-up automático
              </p>
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[25%]">Nome</TableHead>
                    <TableHead className="w-[15%]">Tempo</TableHead>
                    <TableHead className="w-[40%]">Mensagem</TableHead>
                    <TableHead className="w-[10%]">Status</TableHead>
                    <TableHead className="w-[10%] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((message) => (
                    <TableRow key={message.id} data-testid={`row-followup-${message.id}`}>
                      <TableCell className="font-medium" data-testid={`text-followup-name-${message.id}`}>
                        {message.name}
                      </TableCell>
                      <TableCell data-testid={`text-followup-delay-${message.id}`}>
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{formatDelay(message.delayMinutes)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p 
                          className="text-sm text-muted-foreground truncate max-w-md" 
                          title={message.message}
                          data-testid={`text-followup-message-${message.id}`}
                        >
                          {message.message}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={message.isActive}
                            onCheckedChange={(checked) =>
                              toggleActiveMutation.mutate({ id: message.id, isActive: checked })
                            }
                            disabled={toggleActiveMutation.isPending}
                            data-testid={`switch-toggle-${message.id}`}
                          />
                          <Badge
                            variant={message.isActive ? "default" : "secondary"}
                            data-testid={`badge-status-${message.id}`}
                          >
                            {message.isActive ? "Ativa" : "Inativa"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(message)}
                            data-testid={`button-edit-${message.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-delete-${message.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir mensagem?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja excluir a mensagem "{message.name}"?
                                  Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel data-testid="button-cancel-delete">
                                  Cancelar
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(message.id)}
                                  data-testid={`button-confirm-delete-${message.id}`}
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
    </div>
  );
}
