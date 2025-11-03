import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { Request, Response } from 'express';
import { logSecurityEvent } from './webhook-auth';

// Rate limiter for webhook endpoint
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // limit each IP to 30 requests per minute
  message: 'Too many webhook requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logSecurityEvent('WEBHOOK_RATE_LIMIT', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
      message: 'Rate limit exceeded'
    });
    res.status(429).json({ 
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please wait before sending more requests.'
    });
  },
  skip: (req: Request) => {
    // Skip rate limiting for authenticated internal requests
    return req.headers['x-internal-request'] === 'true' && 
           req.ip === '127.0.0.1';
  }
});

// Stricter rate limiter for suspicious activity
export const strictRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit to 10 requests per 15 minutes for suspicious IPs
  message: 'Suspicious activity detected. Access restricted.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logSecurityEvent('WEBHOOK_STRICT_RATE_LIMIT', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
      message: 'Strict rate limit applied - suspicious activity'
    });
    res.status(429).json({ 
      error: 'Access restricted',
      message: 'Suspicious activity detected. Please contact support if this is an error.'
    });
  }
});

// Global API rate limiter (more lenient)
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute for general API
  message: 'Too many API requests',
  standardHeaders: true,
  legacyHeaders: false
});

// Configure Helmet for security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for compatibility
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  originAgentCluster: true,
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  permittedCrossDomainPolicies: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
});

// Custom security headers for webhook responses
export function webhookSecurityHeaders(req: Request, res: Response, next: Function) {
  // Add specific security headers for webhook endpoint
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Webhook-Version', '1.0');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  next();
}