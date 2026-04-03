import type { EventLog, Company, Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import type { CanonicalInboundEvent, EhrSource } from '../integrations/ehr/types.js';

export type RecordedEvent = {
  eventLog: EventLog;
  company: Company;
  isDuplicate: boolean;
};

export async function recordIncomingEvent(event: CanonicalInboundEvent): Promise<RecordedEvent> {
  const { companyKey, eventMessageId, eventType, communityId } = event;

  const company = await prisma.company.upsert({
    where: { companyKey },
    update: {},
    create: {
      companyKey,
    },
  });

  const existing = await prisma.eventLog.findUnique({
    where: {
      companyId_source_eventType_eventMessageId: {
        companyId: company.id,
        source: event.source,
        eventType: eventType,
        eventMessageId: eventMessageId,
      },
    },
  });

  if (existing) {
    logger.info(
      { eventMessageId: eventMessageId, eventType: eventType, source: event.source },
      'event_already_recorded',
    );
    return { eventLog: existing, company, isDuplicate: true };
  }

  const created = await prisma.eventLog.create({
    data: {
      companyId: company.id,
      source: event.source,
      communityId: communityId ?? null,
      eventType,
      eventMessageId,
      payload: event as unknown as Prisma.InputJsonValue,
      status: 'received',
    },
  });

  logger.info(
    { eventMessageId: created.eventMessageId, eventType: created.eventType },
    'event_recorded',
  );

  return { eventLog: created, company, isDuplicate: false };
}

type EventIdentity = {
  companyId: number;
  eventType: string;
  eventMessageId: string;
  source?: EhrSource;
};

function toCompositeEventWhere(identity: EventIdentity): {
  companyId_source_eventType_eventMessageId: {
    companyId: number;
    source: string;
    eventType: string;
    eventMessageId: string;
  };
} {
  const source = identity.source ?? 'alis';
  return {
    companyId_source_eventType_eventMessageId: {
      companyId: identity.companyId,
      source,
      eventType: identity.eventType,
      eventMessageId: identity.eventMessageId,
    },
  };
}

export async function markEventQueued(identity: EventIdentity): Promise<void> {
  await prisma.eventLog.update({
    where: toCompositeEventWhere(identity),
    data: {
      status: 'queued',
    },
  });
}

export async function markEventProcessed(identity: EventIdentity): Promise<void> {
  await prisma.eventLog.update({
    where: toCompositeEventWhere(identity),
    data: {
      status: 'processed',
      processedAt: new Date(),
      error: null,
    },
  });
}

export async function markEventFailed(identity: EventIdentity, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.eventLog.update({
    where: toCompositeEventWhere(identity),
    data: {
      status: 'failed',
      error: message.slice(0, 500),
    },
  });
}

export async function markEventIgnored(identity: EventIdentity, reason: string): Promise<void> {
  await prisma.eventLog.update({
    where: toCompositeEventWhere(identity),
    data: {
      status: 'ignored',
      error: reason,
      processedAt: new Date(),
    },
  });
}
