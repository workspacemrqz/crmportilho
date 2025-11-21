import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { log } from '../vite';

interface AuthenticatedRequest extends Request {
  isAuthenticated?: boolean;
  webhookSource?: string;
}

// Security audit log function
export function logSecurityEvent(event: string, details: any) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    ...details
  };
  console.error('[SECURITY]', JSON.stringify(logEntry));
  log(`[SECURITY] ${event}: ${JSON.stringify(details)}`);
}

// Validate webhook authenticity
export function validateWebhookAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Check for WAHA API credentials (primary)
    const wahaApiKey = process.env.WAHA_API_KEY;
    const wahaInstance = process.env.WAHA_INSTANCIA;
    
    // Check for Evolution API credentials (backward compatibility)
    const evolutionKey = process.env.EVOLUTION_KEY;
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    const evolutionInstance = process.env.INSTANCIA;
    
    if (!wahaApiKey && !evolutionKey && !webhookSecret) {
      logSecurityEvent('WEBHOOK_CONFIG_ERROR', {
        message: 'No webhook authentication configured',
        ip: req.ip
      });
      return res.status(500).json({ error: 'Webhook authentication not configured' });
    }

    // Get headers
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'] || req.headers['apikey'];
    const evolutionHeader = req.headers['x-evolution-key'];
    
    // Method 1: Check WAHA API key (priority)
    if (wahaApiKey && apiKeyHeader === wahaApiKey) {
      // Validate WAHA session/instance name if present in payload
      if (wahaInstance && req.body?.session && req.body.session !== wahaInstance) {
        logSecurityEvent('WEBHOOK_INVALID_SESSION', {
          ip: req.ip,
          expected: wahaInstance,
          received: req.body.session,
          source: 'waha-api'
        });
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'Invalid session/instance name'
        });
      }
      
      req.isAuthenticated = true;
      req.webhookSource = 'waha-api';
      logSecurityEvent('WEBHOOK_AUTH_SUCCESS', {
        ip: req.ip,
        source: 'waha-api',
        session: req.body?.session
      });
      return next();
    }
    
    // Method 1b: DEVELOPMENT MODE ONLY - session-based weak authentication
    // ⚠️ SECURITY WARNING: This is insecure and should ONLY be used in development!
    // Configure WAHA to send x-api-key header in production instead.
    if (wahaInstance && req.body?.session === wahaInstance) {
      const isProduction = process.env.NODE_ENV === 'production';
      const allowWeakAuth = process.env.ALLOW_WEAK_WEBHOOK_AUTH === 'true';
      
      // BLOCK weak auth in production even if flag is set
      if (isProduction) {
        logSecurityEvent('WEBHOOK_WEAK_AUTH_BLOCKED', {
          ip: req.ip,
          session: req.body.session,
          error: 'Weak authentication blocked in production environment',
          action: 'Configure WAHA to send x-api-key header'
        });
        return res.status(401).json({ 
          error: 'Unauthorized',
          message: 'Header-based authentication required in production'
        });
      }
      
      // Allow weak auth ONLY in development if explicitly enabled
      if (allowWeakAuth) {
        console.warn('🚨 SECURITY WARNING: Using weak webhook authentication! This is INSECURE!');
        console.warn('   Configure WAHA to send x-api-key header for production use.');
        
        req.isAuthenticated = true;
        req.webhookSource = 'waha-session-weak';
        logSecurityEvent('WEBHOOK_AUTH_SUCCESS', {
          ip: req.ip,
          source: 'waha-session-weak',
          session: req.body.session,
          environment: 'development',
          warning: '🚨 INSECURE: Weak auth enabled! Configure x-api-key header for production'
        });
        return next();
      }
    }
    
    // Method 2: Check Evolution API key (backward compatibility)
    if (evolutionKey) {
      if (authHeader === `Bearer ${evolutionKey}` ||
          apiKeyHeader === evolutionKey ||
          evolutionHeader === evolutionKey) {
        req.isAuthenticated = true;
        req.webhookSource = 'evolution-api';
        return next();
      }
    }

    // Method 3: Validate webhook signature if secret is configured (Evolution)
    if (webhookSecret && req.headers['x-webhook-signature']) {
      const signature = req.headers['x-webhook-signature'] as string;
      const payload = JSON.stringify(req.body);
      
      // Calculate expected signature
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');
      
      if (signature === expectedSignature) {
        req.isAuthenticated = true;
        req.webhookSource = 'evolution-api-signed';
        return next();
      } else {
        logSecurityEvent('WEBHOOK_INVALID_SIGNATURE', {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          signature: signature.substring(0, 10) + '...',
          method: req.method,
          path: req.path
        });
      }
    }

    // Method 4: Check for Evolution instance name in payload (weak auth)
    if (evolutionInstance && req.body?.instance === evolutionInstance) {
      // Additional check but less secure, log warning
      logSecurityEvent('WEBHOOK_WEAK_AUTH', {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        instance: evolutionInstance,
        warning: 'Using instance name only - consider adding API key'
      });
      req.isAuthenticated = true;
      req.webhookSource = 'evolution-instance';
      return next();
    }

    // Authentication failed
    logSecurityEvent('WEBHOOK_UNAUTHORIZED', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      headers: Object.keys(req.headers),
      method: req.method,
      path: req.path,
      body: req.body ? Object.keys(req.body) : [],
      checkedWAHA: !!wahaApiKey,
      checkedEvolution: !!evolutionKey
    });

    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or missing webhook authentication'
    });
  } catch (error) {
    logSecurityEvent('WEBHOOK_AUTH_ERROR', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip
    });
    return res.status(500).json({ error: 'Authentication error' });
  }
}

// Rate limit specific IPs after failed attempts
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>();

export function trackFailedAttempts(req: Request): boolean {
  // DESABILITADO para webhooks WAHA - sempre retorna false
  // O sistema estava bloqueando requisições válidas do WAHA
  return false;
  
  /* Código original comentado para referência
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const attempt = failedAttempts.get(ip);

  if (attempt) {
    // Reset counter after 1 hour
    if (now - attempt.lastAttempt > 3600000) {
      failedAttempts.set(ip, { count: 1, lastAttempt: now });
      return false;
    }

    attempt.count++;
    attempt.lastAttempt = now;

    // Block after 5 failed attempts
    if (attempt.count > 5) {
      logSecurityEvent('WEBHOOK_IP_BLOCKED', {
        ip,
        attempts: attempt.count,
        action: 'Blocking IP due to multiple failed attempts'
      });
      return true;
    }
  } else {
    failedAttempts.set(ip, { count: 1, lastAttempt: now });
  }

  return false;
  */
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  Array.from(failedAttempts.entries()).forEach(([ip, attempt]) => {
    if (now - attempt.lastAttempt > 3600000) {
      failedAttempts.delete(ip);
    }
  });
}, 600000); // Clean every 10 minutes