import type { Request, Response } from 'express';
import { app } from '../apps/api/src/server.js';
import { runMigrations } from '../apps/api/src/db/migrate.js';

let migrated = false;

export default async function handler(req: Request, res: Response) {
  if (!migrated) {
    try {
      await runMigrations();
      migrated = true;
    } catch (err: any) {
      console.warn('[Vercel Serverless] Migration attempt:', err.message);
    }
  }
  return app(req, res);
}
