import type { NextFunction, Request, Response } from 'express';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => { void fn(req,res,next).catch(next); }; }
export function fail(status: number, message: string): never { throw new HttpError(status,message); }
