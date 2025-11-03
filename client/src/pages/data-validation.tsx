import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Loader2, 
  Search,
  Calendar,
  Car
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Lead = {
  id: string;
  protocol: string;
  whatsappName: string | null;
  name: string | null;
  birthDate: string | null;
  status: string;
  createdAt: string;
};

type Correction = {
  field: string;
  currentValue: string;
  suggestedValue: string;
  reason: string;
};

type AnalysisResult = {
  corrections: Correction[];
  leadProtocol: string;
  analyzedMessages: number;
};

const fieldLabels: Record<string, string> = {
  birthDate: "Data de Nascimento",
  reserveCar: "Carro Reserva"
};

const fieldIcons: Record<string, any> = {
  birthDate: Calendar,
  reserveCar: Car
};

export default function DataValidation() {
  const { toast } = useToast();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // Fetch all leads
  const { data: leads, isLoading: leadsLoading } = useQuery<Lead[]>({
    queryKey: ['/api/leads'],
  });

  // Analyze conversation mutation
  const analyzeMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const response = await apiRequest('POST', `/api/leads/${leadId}/analyze-conversation`);
      return await response.json() as AnalysisResult;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      if (data.corrections.length === 0) {
        toast({
          title: "Nenhuma inconsistência encontrada",
          description: "Os dados estão corretos e consistentes com a conversa.",
        });
      } else {
        toast({
          title: "Análise concluída",
          description: `Encontradas ${data.corrections.length} inconsistência(s) nos dados.`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Erro ao analisar conversa",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive"
      });
    }
  });

  // Apply corrections mutation
  const applyMutation = useMutation({
    mutationFn: async ({ leadId, corrections }: { leadId: string; corrections: Correction[] }) => {
      const response = await apiRequest('POST', `/api/leads/${leadId}/apply-corrections`, { corrections });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Correções aplicadas",
        description: "Os dados foram atualizados com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      setAnalysisResult(null);
      setSelectedLead(null);
    },
    onError: (error) => {
      toast({
        title: "Erro ao aplicar correções",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive"
      });
    }
  });

  const handleAnalyze = (lead: Lead) => {
    setSelectedLead(lead);
    setAnalysisResult(null);
    analyzeMutation.mutate(lead.id);
  };

  const handleApplyCorrections = () => {
    if (selectedLead && analysisResult && analysisResult.corrections.length > 0) {
      applyMutation.mutate({
        leadId: selectedLead.id,
        corrections: analysisResult.corrections
      });
    }
  };

  const handleCancel = () => {
    setSelectedLead(null);
    setAnalysisResult(null);
  };

  return (
    <div className="h-full overflow-auto p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Validação de Dados
          </h1>
          <p className="text-muted-foreground mt-2">
            Analise conversas do WhatsApp e corrija inconsistências nos dados dos leads
          </p>
        </div>

        {/* Analysis Panel - Shows when a lead is being analyzed */}
        {(selectedLead || analysisResult) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {selectedLead?.protocol} - {selectedLead?.name || selectedLead?.whatsappName}
              </CardTitle>
              <CardDescription>
                Análise de consistência de dados
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {analyzeMutation.isPending && (
                <div className="flex items-center justify-center py-8" data-testid="loader-analyzing">
                  <div className="text-center space-y-2">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="text-sm text-muted-foreground">Analisando conversa...</p>
                  </div>
                </div>
              )}

              {analysisResult && analysisResult.corrections.length === 0 && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Nenhuma inconsistência encontrada. Os dados estão corretos e consistentes com a conversa 
                    ({analysisResult.analyzedMessages} mensagens analisadas).
                  </AlertDescription>
                </Alert>
              )}

              {analysisResult && analysisResult.corrections.length > 0 && (
                <div className="space-y-4">
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Encontradas {analysisResult.corrections.length} inconsistência(s) nos dados 
                      ({analysisResult.analyzedMessages} mensagens analisadas).
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-3">
                    {analysisResult.corrections.map((correction, index) => {
                      const Icon = fieldIcons[correction.field] || AlertTriangle;
                      return (
                        <Card key={index} data-testid={`correction-${index}`}>
                          <CardContent className="pt-6">
                            <div className="space-y-3">
                              <div className="flex items-start gap-3">
                                <Icon className="h-5 w-5 text-orange-600 mt-0.5" />
                                <div className="flex-1 space-y-2">
                                  <div className="font-medium">
                                    {fieldLabels[correction.field] || correction.field}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {correction.reason}
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <div className="space-y-1">
                                      <div className="text-xs text-muted-foreground">Valor Atual</div>
                                      <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20">
                                        <XCircle className="h-3 w-3 mr-1" />
                                        {correction.currentValue || "Não registrado"}
                                      </Badge>
                                    </div>
                                    <div className="space-y-1">
                                      <div className="text-xs text-muted-foreground">Valor Sugerido</div>
                                      <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        {correction.suggestedValue}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  <div className="flex gap-2 justify-end pt-4">
                    <Button 
                      variant="outline" 
                      onClick={handleCancel}
                      data-testid="button-cancel"
                    >
                      Cancelar
                    </Button>
                    <Button 
                      onClick={handleApplyCorrections}
                      disabled={applyMutation.isPending}
                      data-testid="button-apply-corrections"
                    >
                      {applyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Aplicar Correções
                    </Button>
                  </div>
                </div>
              )}

              {!analyzeMutation.isPending && !analysisResult && (
                <div className="flex gap-2 justify-end">
                  <Button 
                    variant="outline" 
                    onClick={handleCancel}
                    data-testid="button-cancel-analysis"
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Leads Table */}
        {!selectedLead && !analysisResult && (
          <Card>
            <CardHeader>
              <CardTitle>Leads com Conversas</CardTitle>
              <CardDescription>
                Selecione um lead para analisar a conversa e identificar inconsistências
              </CardDescription>
            </CardHeader>
            <CardContent>
              {leadsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : !leads || leads.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhum lead encontrado
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Protocolo</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Data de Nascimento</TableHead>
                        <TableHead>Criado em</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.map((lead) => (
                        <TableRow key={lead.id} data-testid={`lead-row-${lead.protocol}`}>
                          <TableCell className="font-medium">{lead.protocol}</TableCell>
                          <TableCell>{lead.name || lead.whatsappName || "Sem nome"}</TableCell>
                          <TableCell>
                            {lead.birthDate 
                              ? format(new Date(lead.birthDate), "dd/MM/yyyy", { locale: ptBR })
                              : "Não informado"
                            }
                          </TableCell>
                          <TableCell>
                            {format(new Date(lead.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAnalyze(lead)}
                              data-testid={`button-analyze-${lead.protocol}`}
                            >
                              <Search className="h-4 w-4 mr-2" />
                              Analisar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
