import type { EventLog, Company } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import type { AlisEvent } from '../webhook/schemas.js';

export type RecordedEvent = {
  eventLog: EventLog;
  company: Company;
  isDuplicate: boolean;
};

export async function recordIncomingEvent(event: AlisEvent): Promise<RecordedEvent> {
  const { CompanyKey, EventMessageId, EventType, CommunityId } = event;

  const company = await prisma.company.upsert({
    where: { companyKey: CompanyKey },
    update: {},
    create: {
      companyKey: CompanyKey,
    },
  });

  const existing = await prisma.eventLog.findUnique({
    where: {
      companyId_eventType_eventMessageId: {
        companyId: company.id,
        eventType: EventType,
        eventMessageId: EventMessageId,
      },
    },
  });

  if (existing) {
    logger.info(
      { eventMessageId: EventMessageId, eventType: EventType },
      'event_already_recorded',
    );
    return { eventLog: existing, company, isDuplicate: true };
  }

  const created = await prisma.eventLog.create({
    data: {
      companyId: company.id,
      communityId: CommunityId ?? null,
      eventType: EventType,
      eventMessageId: EventMessageId,
      payload: event,
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
};

function toCompositeEventWhere(identity: EventIdentity): {
  companyId_eventType_eventMessageId: {
    companyId: number;
    eventType: string;
    eventMessageId: string;
  };
} {
  return {
    companyId_eventType_eventMessageId: {
      companyId: identity.companyId,
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
