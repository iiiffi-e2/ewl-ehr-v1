import type { NextFunction, Request, Response } from 'express';
import basicAuth from 'basic-auth';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Admin authentication middleware
 * - Uses BasicAuth (same credentials as webhook)
 * - Does NOT enforce IP allowlist (unlike webhook auth)
 * - Suitable for admin endpoints that need to be accessed from various IPs
 */
export function authAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Response | void {
  const credentials = basicAuth(req);

  if (
    !credentials ||
    credentials.name !== env.WEBHOOK_BASIC_USER ||
    credentials.pass !== env.WEBHOOK_BASIC_PASS
  ) {
    logger.warn(
      { event: 'admin_auth_failed', ip: extractRemoteIp(req) },
      'admin_basic_auth_failed',
    );
    res.set('WWW-Authenticate', 'Basic realm="Admin API"');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  logger.info(
    { event: 'admin_auth_success', ip: extractRemoteIp(req) },
    'admin_authenticated',
  );

  return next();
}

function extractRemoteIp(req: Request): string | null {
  if (req.ip) return req.ip;
  if (req.socket?.remoteAddress) return req.socket.remoteAddress;
  return null;
}

