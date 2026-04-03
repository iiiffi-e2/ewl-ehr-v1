import type { Request, Response } from 'express';

import { logger } from '../config/logger.js';
import {
  markEventIgnored,
  markEventQueued,
  recordIncomingEvent,
} from '../domains/events.js';
import { resolveEhrAdapter } from '../integrations/ehr/registry.js';
import type { CanonicalInboundEvent, EhrSource } from '../integrations/ehr/types.js';
import { processAlisEventQueue } from '../workers/queue.js';
import type { ProcessAlisEventJobData } from '../workers/types.js';

export async function alisWebhookHandler(req: Request, res: Response): Promise<Response> {
  return handleWebhookBySource('alis', req, res);
}

export async function handleWebhookBySource(
  source: EhrSource,
  req: Request,
  res: Response,
): Promise<Response> {
  const adapter = resolveEhrAdapter(source);
  let event: CanonicalInboundEvent;
  try {
    event = adapter.parseInboundEvent(req.body);
  } catch (error) {
    logger.warn(
      {
        source,
        error: error instanceof Error ? error.message : String(error),
      },
      'webhook_validation_failed',
    );
    return res.status(400).json({
      error: 'Invalid payload',
      details: error instanceof Error ? error.message : 'schema_parse_failed',
    });
  }
  const { eventLog, company, isDuplicate } = await recordIncomingEvent(event);

  if (isDuplicate) {
    return res.status(200).json({ status: 'duplicate' });
  }

  if (!adapter.supportsEventType(event.eventType)) {
    await markEventIgnored(
      {
        companyId: company.id,
        eventType: event.eventType,
        eventMessageId: event.eventMessageId,
        source: event.source,
      },
      `Unsupported event type ${event.eventType as string}`,
    );
    return res.status(202).json({ status: 'ignored' });
  }

  if (event.eventType === 'test.event') {
    await markEventIgnored(
      {
        companyId: company.id,
        eventType: event.eventType,
        eventMessageId: event.eventMessageId,
        source: event.source,
      },
      'Test event acknowledged',
    );
    return res.status(202).json({ status: 'test_acknowledged' });
  }

  const jobData: ProcessAlisEventJobData = {
    source,
    eventMessageId: event.eventMessageId,
    eventType: event.eventType,
    companyKey: event.companyKey,
    companyId: company.id,
    communityId: event.communityId ?? null,
    notificationData: event.notificationData ?? {},
    eventMessageDate: event.eventMessageDate,
  };

  try {
    await processAlisEventQueue.add('process-alis-event', jobData, {
      jobId: `event-${source}-${event.eventType}-${event.eventMessageId}`,
      removeOnComplete: true,
      removeOnFail: false,
    });

    await markEventQueued({
      companyId: company.id,
      eventType: event.eventType,
      eventMessageId: event.eventMessageId,
      source,
    });
  } catch (queueError) {
    logger.error(
      {
        jobId: event.eventMessageId,
        error: queueError instanceof Error ? queueError.message : String(queueError),
      },
      'queue_enqueue_failed',
    );
    throw queueError;
  }

  logger.info(
    {
      eventMessageId: event.eventMessageId,
      eventType: event.eventType,
      source,
      companyId: company.id,
    },
    'webhook_event_enqueued',
  );

  return res.status(202).json({ status: 'queued', id: eventLog.id });
}
