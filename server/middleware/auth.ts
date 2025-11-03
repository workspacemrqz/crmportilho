import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.isAuthenticated) {
    return next();
  }
  
  return res.status(401).json({ 
    error: 'Unauthorized',
    message: 'Authentication required' 
  });
}

export function validateLogin(username: string, password: string): boolean {
  const validUsername = process.env.LOGIN;
  const validPassword = process.env.SENHA;
  
  if (!validUsername || !validPassword) {
    throw new Error('LOGIN and SENHA environment variables must be set');
  }
  
  return username === validUsername && password === validPassword;
}

export function validateRequiredEnvVars(): void {
  const required = ['LOGIN', 'SENHA', 'SESSION_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please configure these variables in your Replit Secrets before starting the application.`
    );
  }
}
