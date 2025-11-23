import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { LayoutDashboard, FileText, Smartphone } from "lucide-react";
import logo from "@/assets/Logo Seguro IA.png";
import clientesIcon from "@/assets/Icones/Clientes.svg";
import conversasIcon from "@/assets/Icones/Conversas.svg";
import fluxoIcon from "@/assets/Icones/Fluxo.svg";
import followupIcon from "@/assets/Icones/Follow-up.svg";
import { Badge } from "@/components/ui/badge";

const menuItems = [
  {
    title: "Painel",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Clientes",
    url: "/clientes",
    icon: clientesIcon,
    isImage: true,
  },
  {
    title: "Conversas",
    url: "/conversas",
    icon: conversasIcon,
    isImage: true,
  },
  {
    title: "Follow-up",
    url: "/followup",
    icon: followupIcon,
    isImage: true,
  },
  {
    title: "Fluxo",
    url: "/fluxo",
    icon: fluxoIcon,
    isImage: true,
  },
  {
    title: "Instâncias",
    url: "/instancias",
    icon: Smartphone,
  },
];

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center">
          <img
            src={logo}
            alt="Seguro IA"
            className="h-8 w-auto object-contain"
            data-testid="img-logo"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <a href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      {item.isImage ? (
                        <img src={item.icon} alt={item.title} className="h-4 w-4" />
                      ) : (
                        <item.icon className="h-4 w-4" />
                      )}
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="text-xs text-muted-foreground">
          © 2025 Seguro IA
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
