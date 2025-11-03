import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure the PostgreSQL pool for regular connections (not WebSocket)
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  // Connection pool configuration for production use
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 10000, // How long to wait for a connection
});

// Initialize Drizzle ORM with node-postgres adapter
export const db = drizzle(pool, { schema });
