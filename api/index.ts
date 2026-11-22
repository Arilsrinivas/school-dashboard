import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../apps/api/dist/server.js';

const INTERNAL_PATH_PARAM = '__educonnect_path';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const requestUrl = new URL(req.url ?? '/api', 'http://vercel.internal');
  const forwardedPath = requestUrl.searchParams.get(INTERNAL_PATH_PARAM);

  if (forwardedPath !== null) {
    const path = forwardedPath.replace(/^\/+/, '');
    const segments = path.split('/');
    if (!path || segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\?#]/.test(segment))) {
      res.statusCode = 400;
      res.end('Invalid API path');
      return;
    }

    requestUrl.searchParams.delete(INTERNAL_PATH_PARAM);
    const query = requestUrl.searchParams.toString();
    req.url = `/api/${path}${query ? `?${query}` : ''}`;
  }

  return app(req as never, res as never);
}
