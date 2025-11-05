import { useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketMessage {
  type: string;
  data: any;
}

interface UseWebSocketOptions {
  onMessage?: (event: WebSocketMessage) => void;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  send: (type: string, data?: any) => void;
}

const MAX_BACKOFF_DELAY = 30000;
const INITIAL_BACKOFF_DELAY = 1000;
const HEARTBEAT_INTERVAL = 25000;

export function useWebSocket(options?: UseWebSocketOptions): UseWebSocketReturn {
  const { onMessage, enabled = true } = options || {};
  
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isManualCloseRef = useRef(false);

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    
    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('[WebSocket] Error sending ping:', error);
        }
      }
    }, HEARTBEAT_INTERVAL);
  }, [stopHeartbeat]);

  const send = useCallback((type: string, data?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: WebSocketMessage = { type, data };
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send message - not connected');
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const url = getWebSocketUrl();
    console.log('[WebSocket] Connecting to:', url);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connection established');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        startHeartbeat();
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          if (message.type === 'pong' || message.type === 'connected') {
            return;
          }

          if (onMessage) {
            onMessage(message);
          }
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Connection error:', error);
      };

      ws.onclose = (event) => {
        console.log(`[WebSocket] Connection closed: ${event.code} - ${event.reason}`);
        setIsConnected(false);
        stopHeartbeat();
        wsRef.current = null;

        if (!isManualCloseRef.current) {
          const backoffDelay = Math.min(
            INITIAL_BACKOFF_DELAY * Math.pow(2, reconnectAttemptsRef.current),
            MAX_BACKOFF_DELAY
          );
          
          // Only log reconnection attempts every 5 attempts to reduce noise
          if (reconnectAttemptsRef.current % 5 === 0) {
            console.log(`[WebSocket] Reconnecting in ${backoffDelay}ms (attempt ${reconnectAttemptsRef.current + 1})`);
          }
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, backoffDelay);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Error creating WebSocket:', error);
    }
  }, [getWebSocketUrl, onMessage, startHeartbeat, stopHeartbeat]);

  const disconnect = useCallback(() => {
    console.log('[WebSocket] Disconnecting');
    isManualCloseRef.current = true;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    stopHeartbeat();
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
  }, [stopHeartbeat]);

  useEffect(() => {
    if (!enabled) {
      console.log('[WebSocket] Disabled - not connecting');
      return;
    }

    isManualCloseRef.current = false;
    connect();

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    isConnected,
    send,
  };
}
