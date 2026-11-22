import type { Express } from 'express';

/** Configure the known ingress topology. Never use `true`, which trusts arbitrary XFF chains. */
export function configureProxyTrust(app: Pick<Express, 'set'>, runningOnVercel: boolean): void {
  app.set('trust proxy', runningOnVercel ? 1 : false);
}
