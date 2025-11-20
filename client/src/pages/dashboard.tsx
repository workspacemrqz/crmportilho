import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Users,
  MessageSquare,
  FileText,
  AlertCircle,
  TrendingUp,
  Activity,
} from "lucide-react";

type DashboardStats = {
  totalLeads: number;
  activeConversations: number;
  pendingDocuments: number;
  urgentLeads: number;
  todayMessages: number;
  conversionRate: number;
  leadsByStatus: Record<string, number>;
  leadsByPriority: Record<string, number>;
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

const STATUS_COLORS = [
  "#3B82F6", // blue - novo
  "#eab308", // yellow - em_atendimento
  "#f97316", // orange - aguardando_documentos
  "#a855f7", // purple - encaminhado
  "#D35400", // dark orange - transferido_humano
  "#22c55e", // green - concluido
  "#6b7280", // gray - cancelado
];

const PRIORITY_COLORS = {
  baixa: "#6b7280",
  normal: "#3B82F6",
  alta: "#f97316",
  urgente: "#ef4444",
};

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (!stats) {
    if (isLoading) {
      return (
        <div className="flex flex-col h-full p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-80" />
            ))}
          </div>
        </div>
      );
    }
    
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Erro ao carregar estatísticas</p>
      </div>
    );
  }

  // Prepare data for charts
  const statusData = Object.entries(stats.leadsByStatus).map(([key, value]) => ({
    name: statusLabels[key] || key,
    value: value,
  }));

  const priorityData = Object.entries(stats.leadsByPriority).map(([key, value]) => ({
    name: priorityLabels[key] || key,
    value: value,
    fill: PRIORITY_COLORS[key as keyof typeof PRIORITY_COLORS] || "#6b7280",
  }));

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-dashboard-title">
            Dashboard
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Visão geral e análise do sistema CRM
          </p>
        </div>

        {/* Metric Cards */}
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card data-testid="card-total-leads">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Leads</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-leads">
                {stats.totalLeads}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Todos os leads cadastrados
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-active-conversations">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Conversas Ativas
              </CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-active-conversations">
                {stats.activeConversations}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Em andamento no momento
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-urgent-leads">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Leads Urgentes</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-urgent-leads">
                {stats.urgentLeads}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Requerem atenção imediata
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-conversion-rate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Taxa de Conversão
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-conversion-rate">
                {stats.conversionRate.toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Leads concluídos com sucesso
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Metrics */}
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <Card data-testid="card-pending-documents">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Aguardando Documentos
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-pending-documents">
                {stats.pendingDocuments}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Leads esperando envio de documentos
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-today-messages">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Mensagens Hoje
              </CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-today-messages">
                {stats.todayMessages}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Total de mensagens trocadas hoje
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          {/* Status Distribution */}
          <Card data-testid="card-status-chart">
            <CardHeader>
              <CardTitle>Distribuição por Status</CardTitle>
              <CardDescription>
                Visualização da distribuição dos leads por status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name}: ${(percent * 100).toFixed(0)}%`
                    }
                    outerRadius={80}
                    fill="#3B82F6"
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={STATUS_COLORS[index % STATUS_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Priority Distribution */}
          <Card data-testid="card-priority-chart">
            <CardHeader>
              <CardTitle>Distribuição por Prioridade</CardTitle>
              <CardDescription>
                Visualização dos leads agrupados por nível de prioridade
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={priorityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3B82F6" radius={[8, 8, 0, 0]}>
                    {priorityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Status Details Table */}
          <Card data-testid="card-status-details">
            <CardHeader>
              <CardTitle>Detalhamento por Status</CardTitle>
              <CardDescription>
                Quantidade de leads em cada status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(stats.leadsByStatus)
                  .sort(([, a], [, b]) => b - a)
                  .map(([status, count]) => (
                    <div
                      key={status}
                      className="flex items-center justify-between"
                      data-testid={`status-detail-${status}`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor:
                              STATUS_COLORS[
                                Object.keys(stats.leadsByStatus).indexOf(status)
                              ],
                          }}
                        />
                        <span className="text-sm font-medium">
                          {statusLabels[status] || status}
                        </span>
                      </div>
                      <span className="text-sm font-bold">{count}</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Priority Details Table */}
          <Card data-testid="card-priority-details">
            <CardHeader>
              <CardTitle>Detalhamento por Prioridade</CardTitle>
              <CardDescription>
                Quantidade de leads em cada nível de prioridade
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(stats.leadsByPriority)
                  .sort(([, a], [, b]) => b - a)
                  .map(([priority, count]) => (
                    <div
                      key={priority}
                      className="flex items-center justify-between"
                      data-testid={`priority-detail-${priority}`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor:
                              PRIORITY_COLORS[
                                priority as keyof typeof PRIORITY_COLORS
                              ],
                          }}
                        />
                        <span className="text-sm font-medium">
                          {priorityLabels[priority] || priority}
                        </span>
                      </div>
                      <span className="text-sm font-bold">{count}</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary Section */}
        <div className="space-y-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-summary-title">
              Resumo Geral
            </h2>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Principais indicadores do sistema CRM
            </p>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Funil de Leads */}
            <Card data-testid="card-summary-funnel">
              <CardHeader>
                <CardTitle className="text-base">Funil de Leads</CardTitle>
                <CardDescription className="text-xs">
                  Fluxo do processo de atendimento
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total de Leads</span>
                  <span className="text-xl font-bold">{stats.totalLeads}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Em Atendimento</span>
                  <span className="text-xl font-bold text-yellow-600 dark:text-yellow-400">
                    {stats.leadsByStatus.em_atendimento || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Concluídos</span>
                  <span className="text-xl font-bold text-green-600 dark:text-green-400">
                    {stats.leadsByStatus.concluido || 0}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Ações Pendentes */}
            <Card data-testid="card-summary-pending">
              <CardHeader>
                <CardTitle className="text-base">Ações Pendentes</CardTitle>
                <CardDescription className="text-xs">
                  Itens que requerem atenção
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Aguardando Docs</span>
                  <span className="text-xl font-bold text-orange-600 dark:text-orange-400">
                    {stats.pendingDocuments}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Transferidos</span>
                  <span className="text-xl font-bold text-purple-600 dark:text-purple-400">
                    {stats.leadsByStatus.transferido_humano || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Urgentes</span>
                  <span className="text-xl font-bold text-red-600 dark:text-red-400">
                    {stats.urgentLeads}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Performance */}
            <Card data-testid="card-summary-performance">
              <CardHeader>
                <CardTitle className="text-base">Performance</CardTitle>
                <CardDescription className="text-xs">
                  Indicadores de eficiência
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Taxa de Conversão</span>
                  <span className="text-xl font-bold text-green-600 dark:text-green-400">
                    {stats.conversionRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Conversas Ativas</span>
                  <span className="text-xl font-bold text-orange-600 dark:text-orange-400">
                    {stats.activeConversations}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Mensagens Hoje</span>
                  <span className="text-xl font-bold">
                    {stats.todayMessages}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
