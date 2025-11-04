import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { securityHeaders } from "./middleware/security";
import { logSecurityEvent } from "./middleware/webhook-auth";
import { validateRequiredEnvVars } from "./middleware/auth";

// Validate required environment variables before starting
try {
  validateRequiredEnvVars();
} catch (error) {
  console.error('❌ Configuration Error:', error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = express();

// Apply security headers globally
app.use(securityHeaders);

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    isAuthenticated?: boolean;
  }
}

// Configure session middleware
app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Configure body parsing with raw body capture for webhook signature validation
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    // Em desenvolvimento, o frontend roda separado em :5000 via Vite.
    // Não acoplamos Vite ao Express aqui.
  } else {
    serveStatic(app);
  }

  // Backend na porta 3000 por padrão (configurável via PORT)
  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
  });
})();
