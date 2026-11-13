import type { Request, Response } from 'express';
import { app } from '../apps/api/src/server.js';
import { runMigrations } from '../apps/api/src/db/migrate.js';

let migrationsAttempted = false;

export default async function handler(req: Request, res: Response) {
  if (!migrationsAttempted) {
    migrationsAttempted = true;
    try {
      await runMigrations();
    } catch (err: any) {
      console.warn('[Vercel Serverless] Migration warning:', err.message);
    }
  }
  return app(req, res);
}
