import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Paperclip, X, FileText } from "lucide-react";
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
  metadata?: {
    filename?: string;
    fileUrl?: string;
    size?: number;
  };
}

interface ChatInterfaceProps {
  conversationId: string;
  protocol: string;
  contactName: string;
  status: string;
}

export default function ChatInterface({ conversationId, protocol, contactName, status }: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
      
      // Remove duplicates by content and isBot (keep first occurrence)
      // Messages with same content and same sender (bot/user) within 5 seconds are considered duplicates
      const isDuplicate = self.findIndex(m => {
        if (m.id === message.id) return true; // Same message
        
        const isSameContent = m.content === message.content && m.isBot === message.isBot;
        if (!isSameContent) return false;
        
        // Check if timestamps are within 5 seconds
        const timeDiff = Math.abs(
          new Date(m.timestamp).getTime() - new Date(message.timestamp).getTime()
        );
        return timeDiff < 5000; // 5 seconds
      }) === index;
      
      return isDuplicate;
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
    onMutate: async (message: string) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['/api/conversations', conversationId, 'messages'] });
      
      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData<Message[]>(['/api/conversations', conversationId, 'messages']);
      
      // Optimistically update to the new value
      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        content: message,
        isBot: true,
        messageType: 'text',
        timestamp: new Date().toISOString(),
      };
      
      queryClient.setQueryData<Message[]>(
        ['/api/conversations', conversationId, 'messages'],
        (old = []) => [...old, optimisticMessage]
      );
      
      // Return context with the previous messages
      return { previousMessages };
    },
    onSuccess: (data) => {
      // Invalidate messages to refresh with real data from server
      queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId, 'messages'] });
      
      if (data?.botPaused) {
        toast({
          title: "Bot pausado",
          description: "Respostas automáticas pausadas por 24 horas. Você pode continuar enviando mensagens manualmente.",
        });
      }
    },
    onError: (error, variables, context) => {
      // Rollback to previous messages on error
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ['/api/conversations', conversationId, 'messages'],
          context.previousMessages
        );
      }
      
      toast({
        title: "Erro",
        description: "Falha ao enviar mensagem. Tente novamente.",
        variant: "destructive"
      });
    }
  });

  // Send file mutation
  const sendFileMutation = useMutation({
    mutationFn: async ({ file, caption }: { file: File; caption: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', caption || file.name);

      const response = await fetch(`/api/conversations/${conversationId}/send-file`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to send file');
      }

      return response.json();
    },
    onMutate: async ({ file, caption }: { file: File; caption: string }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/conversations', conversationId, 'messages'] });
      
      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData<Message[]>(['/api/conversations', conversationId, 'messages']);
      
      // Determine message type based on file mimetype
      const isImage = file.type.startsWith('image/');
      const messageType = isImage ? 'image' : 'document';
      
      // Create temporary file URL for preview (only for images)
      const tempFileUrl = isImage ? URL.createObjectURL(file) : undefined;
      
      // Optimistically update with file message
      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        content: caption || file.name,
        isBot: true,
        messageType,
        timestamp: new Date().toISOString(),
        metadata: {
          filename: file.name,
          fileUrl: tempFileUrl,
          size: file.size,
        }
      };
      
      queryClient.setQueryData<Message[]>(
        ['/api/conversations', conversationId, 'messages'],
        (old = []) => [...old, optimisticMessage]
      );
      
      // Return context with the previous messages
      return { previousMessages };
    },
    onSuccess: (data) => {
      // Invalidate messages to refresh with real data from server
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
    onError: (error, variables, context) => {
      // Rollback to previous messages on error
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ['/api/conversations', conversationId, 'messages'],
          context.previousMessages
        );
      }
      
      toast({
        title: "Erro",
        description: "Falha ao enviar arquivo. Tente novamente.",
        variant: "destructive"
      });
    }
  });

  const handleSend = () => {
    // If there's a file selected, send it with the caption
    if (selectedFile) {
      sendFileMutation.mutate({ 
        file: selectedFile, 
        caption: input.trim() || selectedFile.name 
      });
      setSelectedFile(null);
      setInput("");
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }
    
    // Otherwise, send text message
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

    // Store the file to be sent when user clicks send button
    setSelectedFile(file);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
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
            messageType={message.messageType}
            metadata={message.metadata}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-2 sm:p-4">
        {/* File preview */}
        {selectedFile && (
          <div className="mb-2 flex items-center gap-2 p-2 bg-muted rounded-md">
            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={handleRemoveFile}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

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
            disabled={sendFileMutation.isPending || !!selectedFile}
          >
            <Paperclip className="h-5 w-5" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={selectedFile ? "Digite uma legenda (opcional)..." : "Digite sua mensagem..."}
            className="resize-none min-h-[2.5rem] flex-1"
            data-testid="input-message"
          />
          <Button 
            onClick={handleSend}
            size="icon"
            className="flex-shrink-0"
            data-testid="button-send"
            disabled={sendMessageMutation.isPending || sendFileMutation.isPending || (!input.trim() && !selectedFile)}
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
