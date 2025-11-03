import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ConversationList from "@/components/ConversationList";
import ChatInterface from "@/components/ChatInterface";
import { MessageSquare } from "lucide-react";

type Conversation = {
  id: string;
  leadId: string;
  protocol: string;
  status: string;
  currentMenu: string | null;
  currentStep: string | null;
  waitingFor: string | null;
  startedAt: string;
  endedAt: string | null;
  lastActivity: string;
  lead: {
    id: string;
    protocol: string;
    name: string | null;
    phone: string;
    status: string;
    priority: string;
  };
};

export default function Conversations() {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [showConversationList, setShowConversationList] = useState(true);

  // Fetch conversations from API
  const { data: conversationsData = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ['/api/conversations'],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Transform API data to match ConversationList format
  const conversations = conversationsData.map(conv => ({
    id: conv.id,
    contactName: conv.lead.name || conv.lead.phone,
    lastMessage: conv.currentStep || 'Aguardando resposta',
    timestamp: new Date(conv.lastActivity).toLocaleString('pt-BR'),
    unread: 0,
    isActive: conv.status === 'active'
  }));

  const activeConversationData = conversationsData.find(c => c.id === selectedConversation);
  const activeConversation = conversations.find(c => c.id === selectedConversation);

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      <div className={`${showConversationList ? 'flex' : 'hidden'} md:flex w-full md:w-80 border-r md:flex-shrink-0 flex-col h-full md:h-auto overflow-hidden`}>
        <div className="p-4 border-b">
          <h2 className="text-base sm:text-lg font-semibold" data-testid="text-conversations-title">
            Conversas Ativas
          </h2>
        </div>
        <div className="overflow-y-auto flex-1">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhuma conversa ativa</h3>
              <p className="text-sm text-muted-foreground">
                As conversas aparecerão aqui quando iniciadas
              </p>
            </div>
          ) : (
            <ConversationList
              conversations={conversations.map(c => ({
                ...c,
                isActive: c.id === selectedConversation
              }))}
              onSelect={(id) => {
                setSelectedConversation(id);
                setShowConversationList(false);
                console.log(`Selected conversation: ${id}`);
              }}
            />
          )}
        </div>
      </div>

      <div className={`${showConversationList ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-h-0 overflow-hidden`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Carregando conversas...
          </div>
        ) : activeConversation && activeConversationData ? (
          <>
            <div className="md:hidden p-2 border-b">
              <button
                onClick={() => setShowConversationList(true)}
                className="text-sm text-primary hover:underline flex items-center gap-1"
                data-testid="button-back-to-list"
              >
                ← Voltar para lista
              </button>
            </div>
            <ChatInterface
              conversationId={activeConversationData.id}
              protocol={activeConversationData.lead.protocol}
              contactName={activeConversation.contactName}
              status={activeConversationData.status === 'active' ? 'Ativa' : 'Encerrada'}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm sm:text-base">
            Selecione uma conversa
          </div>
        )}
      </div>
    </div>
  );
}
