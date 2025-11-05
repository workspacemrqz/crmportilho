import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Paperclip } from "lucide-react";
import MessageBubble from "./MessageBubble";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface Message {
  id: string;
  content: string;
  isBot: boolean;
  messageType: string;
  timestamp: string;
}

interface ChatInterfaceProps {
  conversationId: string;
  protocol: string;
  contactName: string;
  status: string;
}

export default function ChatInterface({ conversationId, protocol, contactName, status }: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch messages from API
  const { data: messagesData = [] } = useQuery<Message[]>({
    queryKey: ['/api/conversations', conversationId, 'messages'],
  });

  // Filter out system messages and remove duplicates, then sort chronologically (oldest first)
  const messages = [...messagesData]
    .filter((message, index, self) => {
      // Remove system messages (messageType === 'system')
      if (message.messageType === 'system') {
        return false;
      }
      // Remove duplicates by id (keep first occurrence)
      return self.findIndex(m => m.id === message.id) === index;
    })
    .sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      return apiRequest('POST', `/api/conversations/${conversationId}/send`, {
        message,
        type: 'text'
      }) as Promise<{ botPaused?: boolean; pausedUntil?: string }>;
    },
    onSuccess: (data) => {
      // Invalidate messages to refresh
      queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId, 'messages'] });
      
      if (data?.botPaused) {
        toast({
          title: "Bot pausado",
          description: "Respostas automáticas pausadas por 24 horas. Você pode continuar enviando mensagens manualmente.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Falha ao enviar mensagem. Tente novamente.",
        variant: "destructive"
      });
    }
  });

  // Send file mutation
  const sendFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', file.name);

      const response = await fetch(`/api/conversations/${conversationId}/send-file`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to send file');
      }

      return response.json();
    },
    onSuccess: (data) => {
      // Invalidate messages to refresh
      queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId, 'messages'] });
      
      toast({
        title: "Arquivo enviado",
        description: "Arquivo enviado com sucesso.",
      });

      if (data?.botPaused) {
        toast({
          title: "Bot pausado",
          description: "Respostas automáticas pausadas por 24 horas.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Falha ao enviar arquivo. Tente novamente.",
        variant: "destructive"
      });
    }
  });

  const handleSend = () => {
    if (!input.trim()) return;
    
    sendMessageMutation.mutate(input);
    setInput("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Arquivo muito grande",
        description: "O arquivo deve ter no máximo 10MB.",
        variant: "destructive"
      });
      return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Tipo de arquivo inválido",
        description: "Apenas arquivos JPEG, PNG, PDF e DOC são permitidos.",
        variant: "destructive"
      });
      return;
    }

    sendFileMutation.mutate(file);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 sm:p-4 border-b gap-2">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <h2 className="text-base sm:text-lg font-semibold truncate" data-testid="text-contact-name">{contactName}</h2>
          <span className="text-xs text-muted-foreground truncate" data-testid="text-protocol">Protocolo: {protocol}</span>
        </div>
        <Badge className="flex-shrink-0">{status}</Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            content={message.content}
            isBot={message.isBot}
            timestamp={new Date(message.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-2 sm:p-4">
        <div className="flex gap-1 sm:gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/jpg,image/png,application/pdf,.doc,.docx"
            onChange={handleFileSelect}
            data-testid="input-file"
          />
          <Button 
            variant="ghost" 
            size="icon"
            className="flex-shrink-0"
            data-testid="button-attach"
            onClick={handleAttachClick}
            disabled={sendFileMutation.isPending}
          >
            <Paperclip className="h-5 w-5" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Digite sua mensagem..."
            className="resize-none min-h-[2.5rem] flex-1"
            data-testid="input-message"
          />
          <Button 
            onClick={handleSend}
            size="icon"
            className="flex-shrink-0"
            data-testid="button-send"
            disabled={sendMessageMutation.isPending}
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
