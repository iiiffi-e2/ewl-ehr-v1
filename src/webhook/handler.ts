import type { Request, Response } from 'express';

import { logger } from '../config/logger.js';
import {
  markEventIgnored,
  markEventQueued,
  recordIncomingEvent,
} from '../domains/events.js';
import { processAlisEventQueue } from '../workers/queue.js';
import type { ProcessAlisEventJobData } from '../workers/types.js';

import { AlisEventSchema, isSupportedEventType } from './schemas.js';

export async function alisWebhookHandler(req: Request, res: Response): Promise<Response> {
  const parsed = AlisEventSchema.safeParse(req.body);

  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'webhook_validation_failed');
    return res.status(400).json({
      error: 'Invalid payload',
      details: parsed.error.flatten(),
    });
  }

  const event = parsed.data;

  const { eventLog, company, isDuplicate } = await recordIncomingEvent(event);

  if (isDuplicate) {
    return res.status(200).json({ status: 'duplicate' });
  }

  if (!isSupportedEventType(event.EventType)) {
    await markEventIgnored(
      event.EventMessageId,
      `Unsupported event type ${event.EventType as string}`,
    );
    return res.status(202).json({ status: 'ignored' });
  }

  if (event.EventType === 'test.event') {
    await markEventIgnored(event.EventMessageId, 'Test event acknowledged');
    return res.status(202).json({ status: 'test_acknowledged' });
  }

  const jobData: ProcessAlisEventJobData = {
    eventMessageId: event.EventMessageId,
    eventType: event.EventType,
    companyKey: event.CompanyKey,
    companyId: company.id,
    communityId: event.CommunityId ?? null,
    notificationData: event.NotificationData ?? {},
    eventMessageDate: event.EventMessageDate,
  };

  try {
    await processAlisEventQueue.add('process-alis-event', jobData, {
      jobId: `event-${event.EventMessageId}`,
      removeOnComplete: true,
      removeOnFail: false,
    });

    await markEventQueued(event.EventMessageId);
  } catch (queueError) {
    logger.error(
      {
        jobId: event.EventMessageId,
        error: queueError instanceof Error ? queueError.message : String(queueError),
      },
      'queue_enqueue_failed',
    );
    throw queueError;
  }

  logger.info(
    {
      eventMessageId: event.EventMessageId,
      eventType: event.EventType,
      companyId: company.id,
    },
    'webhook_event_enqueued',
  );

  return res.status(202).json({ status: 'queued', id: eventLog.id });
}
