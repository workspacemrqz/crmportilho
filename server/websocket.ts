import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import type { IncomingMessage } from 'http';
import type { Message, Conversation } from '@shared/schema';

// Define WebSocket message types
export interface WebSocketMessage {
  type: string;
  data: any;
}

// Extend WebSocket to include session data
interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
  sessionId?: string;
}

// Connection management: Map of userId to Set of WebSocket connections
const userConnections = new Map<string, Set<AuthenticatedWebSocket>>();

// Store to retrieve session data (will be injected by setupWebSocket)
let sessionStore: any = null;
let sessionSecret: string = '';

/**
 * Simple cookie parser
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.split('=');
    const value = rest.join('=').trim();
    if (name && value) {
      cookies[name.trim()] = decodeURIComponent(value);
    }
  });
  return cookies;
}

/**
 * Parse session cookie and authenticate WebSocket connection
 */
async function authenticateWebSocket(
  req: IncomingMessage
): Promise<{ userId: string; sessionId: string } | null> {
  try {
    const cookies = req.headers.cookie;
    if (!cookies) {
      console.log('[WebSocket] No cookies found in request');
      return null;
    }

    const parsedCookies = parseCookies(cookies);
    const sessionCookie = parsedCookies['connect.sid'];
    
    if (!sessionCookie) {
      console.log('[WebSocket] No session cookie found');
      return null;
    }

    // Decode session ID (express-session uses signed cookies)
    // Format: s:sessionId.signature
    const sessionId = sessionCookie.startsWith('s:') 
      ? sessionCookie.slice(2).split('.')[0]
      : sessionCookie;

    if (!sessionStore) {
      console.error('[WebSocket] Session store not initialized');
      return null;
    }

    // Get session from store
    return new Promise((resolve) => {
      sessionStore.get(sessionId, (err: any, sessionData: any) => {
        if (err) {
          console.error('[WebSocket] Error retrieving session:', err);
          resolve(null);
          return;
        }

        if (!sessionData || !sessionData.isAuthenticated) {
          console.log('[WebSocket] Session not authenticated');
          resolve(null);
          return;
        }

        console.log(`[WebSocket] Session authenticated for user: ${sessionData.userId}`);
        resolve({
          userId: sessionData.userId,
          sessionId
        });
      });
    });
  } catch (error) {
    console.error('[WebSocket] Authentication error:', error);
    return null;
  }
}

/**
 * Add connection to user's connection set
 */
function addConnection(userId: string, ws: AuthenticatedWebSocket): void {
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  userConnections.get(userId)!.add(ws);
  console.log(`[WebSocket] User ${userId} connected. Total connections: ${userConnections.get(userId)!.size}`);
}

/**
 * Remove connection from user's connection set
 */
function removeConnection(userId: string, ws: AuthenticatedWebSocket): void {
  const connections = userConnections.get(userId);
  if (connections) {
    connections.delete(ws);
    if (connections.size === 0) {
      userConnections.delete(userId);
      console.log(`[WebSocket] User ${userId} has no more connections`);
    } else {
      console.log(`[WebSocket] User ${userId} disconnected. Remaining connections: ${connections.size}`);
    }
  }
}

/**
 * Send message to a WebSocket client
 */
function sendMessage(ws: WebSocket, type: string, data: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      const message: WebSocketMessage = { type, data };
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[WebSocket] Error sending message:', error);
    }
  }
}

/**
 * Broadcast message to all connected clients
 */
export function broadcastToAll(event: string, data: any): void {
  let sentCount = 0;
  userConnections.forEach((connections) => {
    connections.forEach((ws) => {
      sendMessage(ws, event, data);
      sentCount++;
    });
  });
  console.log(`[WebSocket] Broadcast "${event}" sent to ${sentCount} clients`);
}

/**
 * Broadcast message to specific user (all their connections)
 */
export function broadcastToUser(userId: string, event: string, data: any): void {
  const connections = userConnections.get(userId);
  if (!connections || connections.size === 0) {
    return;
  }

  connections.forEach((ws) => {
    sendMessage(ws, event, data);
  });
}

/**
 * Broadcast new message to all connected clients
 */
export function broadcastNewMessage(conversationId: string, message: Message): void {
  broadcastToAll('message:new', {
    conversationId,
    message
  });
}

/**
 * Broadcast conversation update to all connected clients
 */
export function broadcastConversationUpdate(conversationId: string, conversation: Conversation): void {
  broadcastToAll('conversation:update', {
    conversationId,
    conversation
  });
}

/**
 * Broadcast new conversation to all connected clients
 */
export function broadcastNewConversation(conversation: Conversation): void {
  broadcastToAll('conversation:new', {
    conversation
  });
}

/**
 * Setup WebSocket server with HTTP server and session configuration
 */
export function setupWebSocket(
  httpServer: HTTPServer,
  sessionConfig: {
    store: any;
    secret: string;
  }
): WebSocketServer {
  // Store session configuration for authentication
  sessionStore = sessionConfig.store;
  sessionSecret = sessionConfig.secret;

  // Create WebSocket server
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
  });

  console.log('[WebSocket] Server initialized on path /ws');

  // Handle new connections
  wss.on('connection', async (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
    console.log('[WebSocket] New connection attempt');

    // Authenticate connection
    const auth = await authenticateWebSocket(req);
    
    if (!auth) {
      console.log('[WebSocket] Authentication failed, closing connection');
      ws.close(1008, 'Authentication required');
      return;
    }

    // Set user info and initialize heartbeat
    ws.userId = auth.userId;
    ws.sessionId = auth.sessionId;
    ws.isAlive = true;

    // Add to connection pool
    addConnection(auth.userId, ws);

    // Send welcome message
    sendMessage(ws, 'connected', {
      message: 'WebSocket connection established',
      userId: auth.userId,
      timestamp: new Date().toISOString()
    });

    // Handle pong responses (for heartbeat)
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WebSocketMessage;

        // Handle ping from client
        if (message.type === 'ping') {
          sendMessage(ws, 'pong', { timestamp: new Date().toISOString() });
          return;
        }

        // Handle other message types as needed
        // For now, just echo back for testing
        if (message.type === 'echo') {
          sendMessage(ws, 'echo', message.data);
        }
      } catch (error) {
        console.error('[WebSocket] Error parsing message:', error);
      }
    });

    // Handle connection close
    ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[WebSocket] Connection closed for user ${ws.userId}: ${code} - ${reason.toString()}`);
      if (ws.userId) {
        removeConnection(ws.userId, ws);
      }
    });

    // Handle errors
    ws.on('error', (error: Error) => {
      console.error(`[WebSocket] Error for user ${ws.userId}:`, error);
    });
  });

  // Heartbeat interval - ping clients every 30 seconds
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      const client = ws as AuthenticatedWebSocket;
      
      if (client.isAlive === false) {
        console.log(`[WebSocket] Terminating inactive connection for user ${client.userId}`);
        if (client.userId) {
          removeConnection(client.userId, client);
        }
        return client.terminate();
      }

      client.isAlive = false;
      client.ping();
    });
  }, 30000); // 30 seconds

  // Cleanup on server close
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    console.log('[WebSocket] Server closed');
  });

  // Log server errors
  wss.on('error', (error: Error) => {
    console.error('[WebSocket] Server error:', error);
  });

  console.log('[WebSocket] Server setup complete');
  
  return wss;
}

/**
 * Get statistics about current connections
 */
export function getConnectionStats() {
  const totalUsers = userConnections.size;
  let totalConnections = 0;
  
  userConnections.forEach((connections) => {
    totalConnections += connections.size;
  });

  return {
    totalUsers,
    totalConnections,
    users: Array.from(userConnections.keys())
  };
}
