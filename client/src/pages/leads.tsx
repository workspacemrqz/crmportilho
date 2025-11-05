import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
} from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Eye, ArrowUpDown, Phone, Mail, Trash2, FileText, Download, ExternalLink, Edit, Lock, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { FormDescription } from "@/components/ui/form";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

type Lead = {
  id: string;
  protocol: string;
  whatsappName: string | null;
  name: string | null;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  whatsappPhone: string;
  birthDate: string | null;
  maritalStatus: string | null;
  profession: string | null;
  address: string | null;
  cep: string | null;
  isPrincipalDriver: boolean | null;
  status: string;
  priority: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type Document = {
  id: string;
  leadId: string;
  filename: string;
  type: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  uploadedAt: string;
};

const statusLabels: Record<string, string> = {
  novo: "Novo",
  em_atendimento: "Em Atendimento",
  aguardando_documentos: "Aguardando Documentos",
  encaminhado: "Encaminhado",
  transferido_humano: "Transferido",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

const priorityLabels: Record<string, string> = {
  baixa: "Baixa",
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};

const statusColors: Record<string, string> = {
  novo: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  em_atendimento: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
  aguardando_documentos: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  encaminhado: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  transferido_humano: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  concluido: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  cancelado: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

const priorityColors: Record<string, string> = {
  baixa: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
  normal: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  alta: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  urgente: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
};

const newLeadSchema = z.object({
  name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  whatsappPhone: z.string().min(10, "WhatsApp inválido"),
  cpf: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
});

type NewLeadForm = z.infer<typeof newLeadSchema>;

const formatCPF = (cpf: string | null): string => {
  if (!cpf) return "Não informado";
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
};

const formatCEP = (cep: string | null): string => {
  if (!cep) return "Não informado";
  return cep.replace(/(\d{5})(\d{3})/, "$1-$2");
};

const formatPhone = (phone: string | null): string => {
  if (!phone) return "Não informado";
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  } else if (cleaned.length === 10) {
    return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }
  return phone;
};

const formatPrincipalDriver = (value: boolean | null | undefined): string => {
  if (value === null || value === undefined) {
    return "Não informado";
  }
  return value === true ? "Sim" : "Não";
};

// Lead Info Tab Component - Shows only populated fields
function LeadInfoTab({ lead }: { lead: Lead }) {
  const fields = [];

  // Only add populated fields
  if (lead.whatsappName) {
    fields.push({ label: "Nome WhatsApp", value: lead.whatsappName });
  }
  if (lead.name) {
    fields.push({ label: "Nome", value: lead.name });
  }
  if (lead.cpf) {
    fields.push({ label: "CPF", value: formatCPF(lead.cpf) });
  }
  if (lead.email) {
    fields.push({ label: "Email", value: lead.email });
  }
  if (lead.whatsappPhone) {
    fields.push({ label: "WhatsApp", value: formatPhone(lead.whatsappPhone) });
  }
  if (lead.phone) {
    fields.push({ label: "Telefone", value: formatPhone(lead.phone) });
  }
  if (lead.birthDate) {
    fields.push({ 
      label: "Data de Nascimento", 
      value: format(new Date(lead.birthDate), "dd/MM/yyyy", { locale: ptBR }) 
    });
  }
  if (lead.maritalStatus) {
    fields.push({ label: "Estado Civil", value: lead.maritalStatus });
  }
  if (lead.profession) {
    fields.push({ label: "Profissão", value: lead.profession });
  }
  if (lead.isPrincipalDriver !== null && lead.isPrincipalDriver !== undefined) {
    fields.push({ 
      label: "É Condutor Principal?", 
      value: lead.isPrincipalDriver ? "Sim" : "Não" 
    });
  }
  if (lead.address) {
    fields.push({ label: "Endereço Completo", value: lead.address, colSpan: 2 });
  }
  if (lead.cep) {
    fields.push({ label: "CEP", value: formatCEP(lead.cep) });
  }

  // Always show status and priority
  fields.push({ 
    label: "Status", 
    value: statusLabels[lead.status] || lead.status,
    badge: true,
    badgeClass: statusColors[lead.status]
  });
  fields.push({ 
    label: "Prioridade", 
    value: priorityLabels[lead.priority] || lead.priority,
    badge: true,
    badgeClass: priorityColors[lead.priority]
  });


  // Always show dates
  fields.push({
    label: "Criado em",
    value: format(new Date(lead.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
  });
  fields.push({
    label: "Atualizado em",
    value: format(new Date(lead.updatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
  });

  return (
    <div className="space-y-6">
      {fields.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map((field, index) => (
            <div 
              key={index} 
              className={`space-y-1 ${field.colSpan === 2 ? 'col-span-2' : ''}`}
              data-testid={`field-${field.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <Label className="text-sm text-muted-foreground">
                {field.label}
              </Label>
              {field.badge ? (
                <div>
                  <Badge variant="outline" className={field.badgeClass}>
                    {field.value}
                  </Badge>
                </div>
              ) : (
                <p className="text-sm font-medium">{field.value}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">Nenhuma informação disponível</p>
        </div>
      )}
      
      <LeadDocumentsSection leadId={lead.id} />
    </div>
  );
}

// Vehicle Info Tab Component - Shows vehicle data from chatbot collected data
function VehicleInfoTab({ leadId }: { leadId: string }) {
  const { data: vehicleData, isLoading } = useQuery({
    queryKey: ['/api/leads', leadId, 'vehicle'],
    queryFn: async () => {
      const response = await fetch(`/api/leads/${leadId}/vehicle-data`);
      if (!response.ok) return null;
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (!vehicleData || !vehicleData.dadosVeiculo) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">
          Nenhuma informação do veículo foi coletada ainda
        </p>
      </div>
    );
  }

  const veiculo = vehicleData.dadosVeiculo;
  const fields = [];

  // Map collected vehicle data to display fields
  if (veiculo.estacionamento) {
    fields.push({ label: "Local de Estacionamento", value: veiculo.estacionamento });
  }
  if (veiculo.tipoPortao) {
    fields.push({ label: "Tipo de Portão", value: veiculo.tipoPortao });
  }
  if (veiculo.usoTrabalhoEstudo) {
    fields.push({ label: "Uso para Trabalho/Estudo", value: veiculo.usoTrabalhoEstudo });
  }
  if (veiculo.tipoResidencia) {
    fields.push({ label: "Tipo de Residência", value: veiculo.tipoResidencia });
  }
  if (veiculo.carroReserva) {
    fields.push({ label: "Carro Reserva", value: veiculo.carroReserva });
  }
  if (veiculo.reboque !== undefined) {
    fields.push({ label: "Deseja Reboque", value: veiculo.reboque ? "Sim" : "Não" });
  }
  if (veiculo.condutorMenor25 !== undefined) {
    fields.push({ label: "Condutor Menor de 25 Anos", value: veiculo.condutorMenor25 ? "Sim" : "Não" });
  }
  if (veiculo.tipoUso) {
    fields.push({ label: "Tipo de Uso do Veículo", value: veiculo.tipoUso });
  }
  
  // Additional vehicle info
  if (veiculo.marca) {
    fields.push({ label: "Marca", value: veiculo.marca });
  }
  if (veiculo.modelo) {
    fields.push({ label: "Modelo", value: veiculo.modelo });
  }
  if (veiculo.ano) {
    fields.push({ label: "Ano", value: veiculo.ano });
  }
  if (veiculo.placa) {
    fields.push({ label: "Placa", value: veiculo.placa });
  }
  if (veiculo.chassis) {
    fields.push({ label: "Chassis", value: veiculo.chassis });
  }

  return (
    <div className="space-y-6">
      {fields.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map((field, index) => (
            <div 
              key={index} 
              className="space-y-1"
              data-testid={`vehicle-field-${field.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <Label className="text-sm text-muted-foreground">
                {field.label}
              </Label>
              <p className="text-sm font-medium">{field.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            Nenhuma informação do veículo disponível
          </p>
        </div>
      )}
    </div>
  );
}

// Lead Documents Section Component - Shows both uploaded documents and WhatsApp documents
function LeadDocumentsSection({ leadId }: { leadId: string }) {
  // Fetch uploaded documents
  const { data: uploadedDocs = [], isLoading: isLoadingUploaded } = useQuery<Document[]>({
    queryKey: ['/api/leads', leadId, 'documents'],
    queryFn: async () => {
      const response = await fetch(`/api/leads/${leadId}`);
      if (!response.ok) throw new Error('Failed to fetch lead details');
      const data = await response.json();
      return data.documents || [];
    },
  });

  // Fetch WhatsApp documents
  const { data: whatsappDocs = [], isLoading: isLoadingWhatsApp } = useQuery<any[]>({
    queryKey: ['/api/leads', leadId, 'whatsapp-documents'],
    queryFn: async () => {
      const response = await fetch(`/api/leads/${leadId}/whatsapp-documents`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.documents || [];
    },
  });

  // Combine all documents
  const allDocuments = [
    ...uploadedDocs,
    ...whatsappDocs.map(doc => ({
      ...doc,
      isWhatsApp: true,
      leadId: leadId // Add leadId for download handling
    }))
  ];

  const isLoading = isLoadingUploaded || isLoadingWhatsApp;
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { toast } = useToast();
  
  // Function to handle document download
  const handleDownload = async (doc: any) => {
    try {
      setDownloadingId(doc.id);
      
      let downloadUrl: string;
      
      if (doc.isWhatsApp && doc.messageId) {
        // For WhatsApp documents, use WhatsApp-specific download endpoint
        downloadUrl = `/api/leads/${doc.leadId}/documents/${doc.messageId}/download`;
      } else {
        // For regular uploaded documents, use document download endpoint
        downloadUrl = `/api/documents/${doc.id}/download`;
      }
      
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        console.error('Failed to download document:', response.status);
        toast({
          title: "Erro no download",
          description: "Não foi possível baixar o documento. Tente novamente.",
          variant: "destructive",
        });
        setDownloadingId(null);
        return;
      }
      
      // Get the filename from headers or use default
      const contentDisposition = response.headers.get('content-disposition');
      const filename = contentDisposition 
        ? contentDisposition.split('filename=')[1]?.replace(/['"]/g, '')
        : doc.filename || `document_${doc.id}`;
      
      // Convert response to blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Download concluído",
        description: `${filename} foi baixado com sucesso.`,
      });
    } catch (error) {
      console.error('Error downloading document:', error);
      toast({
        title: "Erro no download",
        description: "Ocorreu um erro ao baixar o documento.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "Tamanho desconhecido";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(2)} KB`;
  };

  const documentTypeLabels: Record<string, string> = {
    cnh: "CNH",
    rg: "RG",
    cpf: "CPF",
    comprovante_residencia: "Comprovante de Residência",
    documento_veiculo: "Documento do Veículo",
    apolice: "Apólice",
    outro: "Outro",
    document: "Documento",
    image: "Imagem",
    media: "Mídia"
  };

  const getDocumentIcon = (type: string) => {
    if (type === 'image') return '🖼️';
    if (type === 'media') return '📎';
    return '📄';
  };

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" data-testid="text-section-documents">
        <FileText className="h-5 w-5" />
        Documentos ({allDocuments.length})
      </h3>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : allDocuments.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Nenhum documento enviado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allDocuments.map((doc: any) => (
            <div
              key={doc.id}
              className="flex items-center justify-between p-3 border rounded-lg hover-elevate"
              data-testid={`document-item-${doc.id}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0">
                  <FileText className="h-8 w-8 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" data-testid={`document-name-${doc.id}`}>
                    {doc.filename}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {doc.isWhatsApp && (
                      <>
                        <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300">
                          WhatsApp
                        </Badge>
                        <span>•</span>
                      </>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {documentTypeLabels[doc.type] || doc.type}
                    </Badge>
                    <span>•</span>
                    <span>{formatFileSize(doc.size)}</span>
                    <span>•</span>
                    <span>{format(new Date(doc.uploadedAt), "dd/MM/yyyy", { locale: ptBR })}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {doc.url || doc.mediaUrl || (doc.isWhatsApp && doc.messageId) ? (
                  // All documents with download capability
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDownload(doc)}
                      data-testid={`button-download-${doc.id}`}
                      title="Baixar documento"
                      disabled={downloadingId === doc.id}
                    >
                      {downloadingId === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    {!doc.isWhatsApp && (doc.url || doc.mediaUrl) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        asChild
                        data-testid={`button-view-${doc.id}`}
                        title="Visualizar documento"
                      >
                        <a href={doc.url || doc.mediaUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground px-3">Arquivo não disponível</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Edit Lead Form Component with Tabs
function EditLeadForm({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("lead");
  
  // Fetch vehicle data
  const { data: vehicleData } = useQuery({
    queryKey: ['/api/leads', lead.id, 'vehicle'],
    queryFn: async () => {
      const response = await fetch(`/api/leads/${lead.id}/vehicle-data`);
      if (!response.ok) return null;
      return response.json();
    },
  });

  // Lead form
  const leadForm = useForm({
    defaultValues: {
      name: lead.name || '',
      cpf: lead.cpf || '',
      email: lead.email || '',
      phone: lead.phone || '',
      birthDate: lead.birthDate || '',
      maritalStatus: lead.maritalStatus || '',
      profession: lead.profession || '',
      address: lead.address || '',
      cep: lead.cep || '',
      isPrincipalDriver: lead.isPrincipalDriver || false,
      status: lead.status || 'novo',
      priority: lead.priority || 'normal'
    },
  });

  // Vehicle form  
  const vehicleForm = useForm({
    defaultValues: {
      estacionamento: vehicleData?.dadosVeiculo?.estacionamento || '',
      tipoPortao: vehicleData?.dadosVeiculo?.tipoPortao || '',
      usoTrabalhoEstudo: vehicleData?.dadosVeiculo?.usoTrabalhoEstudo || '',
      tipoResidencia: vehicleData?.dadosVeiculo?.tipoResidencia || '',
      carroReserva: vehicleData?.dadosVeiculo?.carroReserva || '',
      reboque: vehicleData?.dadosVeiculo?.reboque || false,
      condutorMenor25: vehicleData?.dadosVeiculo?.condutorMenor25 || false,
      tipoUso: vehicleData?.dadosVeiculo?.tipoUso || ''
    },
  });

  // Update vehicle form when data loads
  useEffect(() => {
    if (vehicleData?.dadosVeiculo) {
      const veiculo = vehicleData.dadosVeiculo;
      vehicleForm.reset({
        estacionamento: veiculo.estacionamento || '',
        tipoPortao: veiculo.tipoPortao || '',
        usoTrabalhoEstudo: veiculo.usoTrabalhoEstudo || '',
        tipoResidencia: veiculo.tipoResidencia || '',
        carroReserva: veiculo.carroReserva || '',
        reboque: veiculo.reboque || false,
        condutorMenor25: veiculo.condutorMenor25 || false,
        tipoUso: veiculo.tipoUso || ''
      });
    }
  }, [vehicleData]);

  const handleLeadSubmit = async (data: any) => {
    try {
      setIsLoading(true);
      await apiRequest('POST', `/api/leads/${lead.id}/update`, data);
      toast({
        title: "Lead atualizado",
        description: "As informações do lead foram atualizadas com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      onClose();
    } catch (error) {
      toast({
        title: "Erro ao atualizar",
        description: "Não foi possível atualizar as informações do lead.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVehicleSubmit = async (data: any) => {
    try {
      setIsLoading(true);
      // Update vehicle data in chatbot state
      await apiRequest('POST', `/api/chatbot/update-vehicle-data`, {
        phone: lead.whatsappPhone,
        vehicleData: data
      });
      toast({
        title: "Dados do veículo atualizados",
        description: "As informações do veículo foram atualizadas com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/leads', lead.id, 'vehicle'] });
      onClose();
    } catch (error) {
      toast({
        title: "Erro ao atualizar",
        description: "Não foi possível atualizar as informações do veículo.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="lead" data-testid="tab-edit-lead">
          Informações do Lead
        </TabsTrigger>
        <TabsTrigger value="vehicle" data-testid="tab-edit-vehicle">
          Informações do Veículo
        </TabsTrigger>
      </TabsList>

      <TabsContent value="lead" className="space-y-4 mt-4">
        <Form {...leadForm}>
          <form onSubmit={leadForm.handleSubmit(handleLeadSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={leadForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="cpf"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPF</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telefone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Nascimento</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="maritalStatus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estado Civil</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="solteiro">Solteiro(a)</SelectItem>
                        <SelectItem value="casado">Casado(a)</SelectItem>
                        <SelectItem value="divorciado">Divorciado(a)</SelectItem>
                        <SelectItem value="viuvo">Viúvo(a)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="profession"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Profissão</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="cep"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CEP</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Endereço</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="novo">Novo</SelectItem>
                        <SelectItem value="em_atendimento">Em Atendimento</SelectItem>
                        <SelectItem value="aguardando_documentos">Aguardando Documentos</SelectItem>
                        <SelectItem value="encaminhado">Encaminhado</SelectItem>
                        <SelectItem value="concluido">Concluído</SelectItem>
                        <SelectItem value="cancelado">Cancelado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prioridade</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="baixa">Baixa</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="alta">Alta</SelectItem>
                        <SelectItem value="urgente">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={leadForm.control}
                name="isPrincipalDriver"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        Principal Condutor
                      </FormLabel>
                      <FormDescription>
                        É o principal condutor do veículo?
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} type="button">
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </TabsContent>

      <TabsContent value="vehicle" className="space-y-4 mt-4">
        <Form {...vehicleForm}>
          <form onSubmit={vehicleForm.handleSubmit(handleVehicleSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={vehicleForm.control}
                name="estacionamento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local de Estacionamento</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex: Garagem, Estacionamento, Rua..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vehicleForm.control}
                name="tipoPortao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Portão</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex: Manual, Automático..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vehicleForm.control}
                name="usoTrabalhoEstudo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Uso para Trabalho/Estudo</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex: Trabalho, Estudo, Ambos, Nenhum..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vehicleForm.control}
                name="tipoResidencia"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Residência</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex: Casa, Apartamento..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vehicleForm.control}
                name="carroReserva"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Carro Reserva</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex: 7 dias, 15 dias, 21 dias, Não desejo..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vehicleForm.control}
                name="tipoUso"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Uso do Veículo</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex: Particular, Comercial, App..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vehicleForm.control}
                name="reboque"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        Deseja Reboque
                      </FormLabel>
                      <FormDescription>
                        Assistência 24h com reboque
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={vehicleForm.control}
                name="condutorMenor25"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        Condutor Menor de 25 Anos
                      </FormLabel>
                      <FormDescription>
                        Algum condutor tem menos de 25 anos?
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} type="button">
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </TabsContent>
    </Tabs>
  );
}

// Password Edit Dialog Component
function EditLeadDialog({ 
  lead, 
  isOpen, 
  onClose 
}: { 
  lead: Lead | null; 
  isOpen: boolean; 
  onClose: () => void; 
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const handlePasswordSubmit = async () => {
    if (!password) {
      toast({
        title: "Senha obrigatória",
        description: "Digite a senha para continuar",
        variant: "destructive"
      });
      return;
    }

    try {
      setIsValidating(true);
      const response = await apiRequest('POST', '/api/workflows/validate-password', { password });
      const data = await response.json();
      
      if (data.valid) {
        setIsAuthorized(true);
        toast({
          title: "Acesso autorizado",
          description: "Você pode editar o lead agora",
        });
      } else {
        toast({
          title: "Senha incorreta",
          description: "A senha digitada está incorreta",
          variant: "destructive"
        });
        setPassword("");
      }
    } catch (error: any) {
      toast({
        title: "Erro",
        description: "Erro ao validar senha",
        variant: "destructive"
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleClose = () => {
    setPassword("");
    setIsAuthorized(false);
    onClose();
  };

  if (!lead) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isAuthorized ? (
              <>
                <Edit className="h-5 w-5" />
                Editar Lead - {lead.protocol}
              </>
            ) : (
              <>
                <Lock className="h-5 w-5" />
                Autenticação Necessária
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isAuthorized 
              ? "Edite as informações do lead abaixo"
              : "Digite a senha para acessar o modo de edição"}
          </DialogDescription>
        </DialogHeader>

        {!isAuthorized ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-password">Senha</Label>
              <Input
                id="edit-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                placeholder="Digite a senha de administrador"
                data-testid="input-edit-password"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button 
                onClick={handlePasswordSubmit} 
                disabled={isValidating || !password}
                data-testid="button-unlock-edit"
              >
                {isValidating ? "Validando..." : "Desbloquear"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <EditLeadForm lead={lead} onClose={handleClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Leads() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  const form = useForm<NewLeadForm>({
    resolver: zodResolver(newLeadSchema),
    defaultValues: {
      name: "",
      whatsappPhone: "",
      cpf: "",
      email: "",
    },
  });

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const onSubmit = async (data: NewLeadForm) => {
    try {
      await apiRequest("POST", "/api/leads", data);

      toast({
        title: "Lead criado com sucesso!",
        description: "O novo lead foi adicionado ao sistema.",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setIsDialogOpen(false);
      form.reset();
    } catch (error) {
      toast({
        title: "Erro ao criar lead",
        description: "Não foi possível criar o lead. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", "/api/leads/clear-all");
    },
    onSuccess: (data: any) => {
      toast({
        title: "Leads removidos com sucesso!",
        description: data.message || `${data.count} leads e todo o histórico de conversas foram removidos.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: () => {
      toast({
        title: "Erro ao remover leads",
        description: "Não foi possível remover os leads. Tente novamente.",
        variant: "destructive",
      });
    }
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ leadId, data }: { leadId: string; data: Partial<Lead> }) => {
      return await apiRequest("POST", `/api/leads/${leadId}/update`, data);
    },
    onSuccess: () => {
      toast({
        title: "Lead atualizado com sucesso!",
        description: "As alterações foram salvas.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: () => {
      toast({
        title: "Erro ao atualizar lead",
        description: "Não foi possível atualizar o lead. Tente novamente.",
        variant: "destructive",
      });
    }
  });

  const filteredLeads = leads
    .filter((lead) => {
      const matchesSearch =
        searchTerm === "" ||
        (lead.whatsappName?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
        (lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
        lead.protocol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.whatsappPhone.includes(searchTerm) ||
        (lead.phone?.includes(searchTerm) ?? false) ||
        (lead.email?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);

      const matchesStatus =
        statusFilter === "all" || lead.status === statusFilter;

      const matchesPriority =
        priorityFilter === "all" || lead.priority === priorityFilter;

      return matchesSearch && matchesStatus && matchesPriority;
    })
    .sort((a, b) => {
      let aValue: any = a[sortField as keyof Lead];
      let bValue: any = b[sortField as keyof Lead];

      if (sortField === "createdAt" || sortField === "updatedAt") {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none p-4 sm:p-6 border-b space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold" data-testid="text-leads-title">
              Leads
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Gerencie todos os leads no formato planilha
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="destructive" 
                  data-testid="button-clear-all-leads"
                  disabled={clearAllMutation.isPending || leads.length === 0}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Limpar Tudo
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent data-testid="dialog-clear-all-leads">
                <AlertDialogHeader>
                  <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação irá remover permanentemente todos os leads e todo o histórico de conversas do sistema. Esta ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-clear">
                    Cancelar
                  </AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="button-confirm-clear"
                    onClick={() => clearAllMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {clearAllMutation.isPending ? "Removendo..." : "Sim, remover tudo"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-lead" className="w-full sm:w-auto">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Lead
                </Button>
              </DialogTrigger>
            <DialogContent className="w-[95vw] max-w-md sm:max-w-lg" data-testid="dialog-add-lead">
              <DialogHeader>
                <DialogTitle>Criar Novo Lead</DialogTitle>
                <DialogDescription>
                  Adicione um novo lead ao sistema
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="João Silva"
                            data-testid="input-lead-name"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="whatsappPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>WhatsApp *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="11987654321"
                            data-testid="input-lead-whatsapp"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cpf"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>CPF</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="12345678901"
                            data-testid="input-lead-cpf"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="joao@email.com"
                            data-testid="input-lead-email"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsDialogOpen(false)}
                      data-testid="button-cancel-lead"
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" data-testid="button-submit-lead">
                      Criar Lead
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, protocolo, telefone ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-leads"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-status-filter">
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
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-priority-filter">
              <SelectValue placeholder="Prioridade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Prioridades</SelectItem>
              {Object.entries(priorityLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span data-testid="text-leads-count">
            {filteredLeads.length} {filteredLeads.length === 1 ? "lead" : "leads"}
          </span>
          {(searchTerm || statusFilter !== "all" || priorityFilter !== "all") && (
            <span>
              (filtrado de {leads.length} {leads.length === 1 ? "total" : "totais"})
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && leads.length === 0 ? (
          <div className="p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum lead encontrado</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {searchTerm || statusFilter !== "all" || priorityFilter !== "all"
                ? "Tente ajustar os filtros de busca"
                : "Comece criando um novo lead"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover-elevate"
                  onClick={() => handleSort("protocol")}
                  data-testid="header-protocol"
                >
                  <div className="flex items-center gap-2">
                    Protocolo
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover-elevate"
                  onClick={() => handleSort("whatsappName")}
                  data-testid="header-whatsapp-name"
                >
                  <div className="flex items-center gap-2">
                    Nome WhatsApp
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead data-testid="header-whatsapp">WhatsApp</TableHead>
                <TableHead
                  className="cursor-pointer hover-elevate"
                  onClick={() => handleSort("status")}
                  data-testid="header-status"
                >
                  <div className="flex items-center gap-2">
                    Status
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover-elevate"
                  onClick={() => handleSort("priority")}
                  data-testid="header-priority"
                >
                  <div className="flex items-center gap-2">
                    Prioridade
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover-elevate"
                  onClick={() => handleSort("updatedAt")}
                  data-testid="header-updated"
                >
                  <div className="flex items-center gap-2">
                    Atualizado
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </TableHead>
                <TableHead className="text-right" data-testid="header-actions">
                  Ações
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLeads.map((lead) => (
                <TableRow key={lead.id} data-testid={`row-lead-${lead.id}`}>
                  <TableCell className="font-medium" data-testid={`cell-protocol-${lead.id}`}>
                    {lead.protocol}
                  </TableCell>
                  <TableCell data-testid={`cell-whatsapp-name-${lead.id}`}>
                    {lead.whatsappName || <span className="text-muted-foreground">Não informado</span>}
                  </TableCell>
                  <TableCell data-testid={`cell-whatsapp-${lead.id}`}>
                    <div className="text-sm">
                      {formatPhone(lead.whatsappPhone)}
                    </div>
                  </TableCell>
                  <TableCell data-testid={`cell-status-${lead.id}`}>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Badge 
                          variant="outline" 
                          className={`${statusColors[lead.status]} cursor-pointer hover-elevate`}
                          data-testid={`badge-status-${lead.id}`}
                        >
                          {statusLabels[lead.status] || lead.status}
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" data-testid={`popover-status-${lead.id}`}>
                        <div className="space-y-1">
                          <p className="text-sm font-medium mb-2">Alterar Status</p>
                          {Object.entries(statusLabels).map(([value, label]) => (
                            <Button
                              key={value}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => {
                                updateLeadMutation.mutate({
                                  leadId: lead.id,
                                  data: { status: value }
                                });
                              }}
                              data-testid={`button-status-${value}-${lead.id}`}
                            >
                              <Badge variant="outline" className={`${statusColors[value]} mr-2`}>
                                {label}
                              </Badge>
                            </Button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </TableCell>
                  <TableCell data-testid={`cell-priority-${lead.id}`}>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Badge 
                          variant="outline" 
                          className={`${priorityColors[lead.priority]} cursor-pointer hover-elevate`}
                          data-testid={`badge-priority-${lead.id}`}
                        >
                          {priorityLabels[lead.priority] || lead.priority}
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" data-testid={`popover-priority-${lead.id}`}>
                        <div className="space-y-1">
                          <p className="text-sm font-medium mb-2">Alterar Prioridade</p>
                          {Object.entries(priorityLabels).map(([value, label]) => (
                            <Button
                              key={value}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start"
                              onClick={() => {
                                updateLeadMutation.mutate({
                                  leadId: lead.id,
                                  data: { priority: value }
                                });
                              }}
                              data-testid={`button-priority-${value}-${lead.id}`}
                            >
                              <Badge variant="outline" className={`${priorityColors[value]} mr-2`}>
                                {label}
                              </Badge>
                            </Button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </TableCell>
                  <TableCell data-testid={`cell-updated-${lead.id}`}>
                    <div className="text-sm">
                      {format(new Date(lead.updatedAt), "dd/MM/yyyy", { locale: ptBR })}
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(lead.updatedAt), "HH:mm", { locale: ptBR })}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right" data-testid={`cell-actions-${lead.id}`}>
                    <Dialog open={isViewDialogOpen && selectedLead?.id === lead.id} onOpenChange={(open) => {
                      setIsViewDialogOpen(open);
                      if (!open) setSelectedLead(null);
                    }}>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-view-lead-${lead.id}`}
                          onClick={() => {
                            setSelectedLead(lead);
                            setIsViewDialogOpen(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="w-[95vw] max-w-3xl max-h-[85vh] overflow-y-auto" data-testid={`dialog-view-lead-${lead.id}`}>
                        <DialogHeader>
                          <div className="flex items-center justify-between">
                            <div>
                              <DialogTitle data-testid="text-lead-details-title">
                                Detalhes do Lead
                              </DialogTitle>
                              <DialogDescription data-testid="text-lead-protocol">
                                Protocolo: {lead.protocol}
                              </DialogDescription>
                            </div>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setIsViewDialogOpen(false);
                                setTimeout(() => {
                                  setSelectedLead(lead);
                                  setIsEditDialogOpen(true);
                                }, 100);
                              }}
                              data-testid={`button-edit-lead-${lead.id}`}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Editar
                            </Button>
                          </div>
                        </DialogHeader>
                        
                        <Tabs defaultValue="lead" className="w-full">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="lead" data-testid="tab-lead-info">
                              Informações do Lead
                            </TabsTrigger>
                            <TabsTrigger value="vehicle" data-testid="tab-vehicle-info">
                              Informações do Veículo
                            </TabsTrigger>
                          </TabsList>
                          
                          <TabsContent value="lead" className="space-y-6 mt-6">
                            <LeadInfoTab lead={lead} />
                          </TabsContent>
                          
                          <TabsContent value="vehicle" className="space-y-6 mt-6">
                            <VehicleInfoTab leadId={lead.id} />
                          </TabsContent>
                        </Tabs>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </div>
      
      {/* Edit Lead Dialog with Password Protection */}
      <EditLeadDialog
        lead={selectedLead}
        isOpen={isEditDialogOpen}
        onClose={() => {
          setIsEditDialogOpen(false);
          setSelectedLead(null);
        }}
      />
    </div>
  );
}
