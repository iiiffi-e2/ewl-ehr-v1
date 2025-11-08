import type { NextFunction, Request, Response } from 'express';
import basicAuth from 'basic-auth';
import ipaddr from 'ipaddr.js';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export function authWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Response | void {
  if (!isIpAllowed(req)) {
    logger.warn({ ip: extractRemoteIp(req) }, 'webhook_request_blocked_ip');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const credentials = basicAuth(req);

  if (
    !credentials ||
    credentials.name !== env.WEBHOOK_BASIC_USER ||
    credentials.pass !== env.WEBHOOK_BASIC_PASS
  ) {
    logger.warn(
      { event: 'webhook_auth_failed', ip: extractRemoteIp(req) },
      'webhook_basic_auth_failed',
    );
    res.set('WWW-Authenticate', 'Basic realm="ALIS Webhook"');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

function isIpAllowed(req: Request): boolean {
  if (!env.ipAllowlist.length) {
    return true;
  }

  const candidateIps = collectCandidateIps(req);

  return candidateIps.some((ip) => env.ipAllowlist.some((allowed) => matchIp(ip, allowed)));
}

function collectCandidateIps(req: Request): string[] {
  const ips = new Set<string>();
  const remote = extractRemoteIp(req);
  if (remote) ips.add(remote);

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    forwarded.split(',').map((ip) => ip.trim()).forEach((ip) => ips.add(ip));
  } else if (Array.isArray(forwarded)) {
    forwarded.forEach((ip) => ips.add(ip));
  }

  return Array.from(ips);
}

function extractRemoteIp(req: Request): string | null {
  if (req.ip) return req.ip;
  if (req.socket?.remoteAddress) return req.socket.remoteAddress;
  return null;
}

function matchIp(ip: string, allowed: string): boolean {
  try {
    if (!ipaddr.isValid(ip)) {
      return false;
    }
    const parsedIp = ipaddr.parse(ip);
    const normalizedIp =
      parsedIp.kind() === 'ipv6' && parsedIp.isIPv4MappedAddress()
        ? parsedIp.toIPv4Address()
        : parsedIp;

    if (allowed.includes('/')) {
      const [range, bits] = allowed.split('/');
      if (!range || !bits || !ipaddr.isValid(range)) {
        return false;
      }
      const parsedRange = ipaddr.parse(range);
      const normalizedRange =
        parsedRange.kind() === 'ipv6' && parsedRange.isIPv4MappedAddress()
          ? parsedRange.toIPv4Address()
          : parsedRange;
      return (normalizedIp as ipaddr.IPv4 | ipaddr.IPv6).match(
        normalizedRange as ipaddr.IPv4 | ipaddr.IPv6,
        Number(bits),
      );
    }

    if (!ipaddr.isValid(allowed)) {
      return false;
    }

    const allowedIp = ipaddr.parse(allowed);
    const normalizedAllowed =
      allowedIp.kind() === 'ipv6' && allowedIp.isIPv4MappedAddress()
        ? allowedIp.toIPv4Address()
        : allowedIp;

    return normalizedIp.toString() === normalizedAllowed.toString();
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'ip_allowlist_parse_error');
    return false;
  }
}
