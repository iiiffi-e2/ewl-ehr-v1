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
    let normalizedIp: ipaddr.IPv4 | ipaddr.IPv6 = parsedIp;
    if (parsedIp.kind() === 'ipv6') {
      const ipv6 = parsedIp as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        normalizedIp = ipv6.toIPv4Address();
      }
    }

    if (allowed.includes('/')) {
      const [range, bits] = allowed.split('/');
      if (!range || !bits || !ipaddr.isValid(range)) {
        return false;
      }
      const parsedRange = ipaddr.parse(range);
      let normalizedRange: ipaddr.IPv4 | ipaddr.IPv6 = parsedRange;
      if (parsedRange.kind() === 'ipv6') {
        const ipv6Range = parsedRange as ipaddr.IPv6;
        if (ipv6Range.isIPv4MappedAddress()) {
          normalizedRange = ipv6Range.toIPv4Address();
        }
      }
      return normalizedIp.match(normalizedRange, Number(bits));
    }

    if (!ipaddr.isValid(allowed)) {
      return false;
    }

    const allowedIp = ipaddr.parse(allowed);
    let normalizedAllowed: ipaddr.IPv4 | ipaddr.IPv6 = allowedIp;
    if (allowedIp.kind() === 'ipv6') {
      const ipv6Allowed = allowedIp as ipaddr.IPv6;
      if (ipv6Allowed.isIPv4MappedAddress()) {
        normalizedAllowed = ipv6Allowed.toIPv4Address();
      }
    }

    return normalizedIp.toString() === normalizedAllowed.toString();
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'ip_allowlist_parse_error');
    return false;
  }
}
