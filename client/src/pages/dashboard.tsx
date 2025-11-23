import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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
  "#3B82F6",
  "#eab308",
  "#22d3ee",
  "#a855f7",
  "#c084fc",
  "#22c55e",
  "#6b7280",
];

const PRIORITY_COLORS = {
  baixa: "#6b7280",
  normal: "#3B82F6",
  alta: "#eab308",
  urgente: "#ef4444",
};

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (!stats) {
    if (isLoading) {
      return (
        <div className="flex flex-col h-full p-4 sm:p-6">
          <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
            {[...Array(2)].map((_, i) => (
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
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
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
        </div>
      </div>
    </div>
  );
}
