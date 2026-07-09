import type { Request, Response } from 'express';

import { logger } from '../config/logger.js';
import { errorToIssueDetails, recordEventIssue } from '../domains/eventIssues.js';
import {
  markEventIgnored,
  markEventQueued,
  recordIncomingEvent,
} from '../domains/events.js';
import { buildHl7Ack } from '../integrations/ehr/hl7Ack.js';
import { resolveEhrAdapter } from '../integrations/ehr/registry.js';
import type { CanonicalInboundEvent, EhrSource } from '../integrations/ehr/types.js';
import { processAlisEventQueue } from '../workers/queue.js';
import type { ProcessAlisEventJobData } from '../workers/types.js';

function isRawHl7Body(body: unknown): body is string {
  return typeof body === 'string';
}

function sendYardiHl7Response(
  req: Request,
  res: Response,
  args: {
    status: number;
    ackCode: 'AA' | 'AE' | 'AR';
    jsonBody: Record<string, unknown>;
    textMessage?: string;
  },
): Response {
  if (isRawHl7Body(req.body)) {
    const ack = buildHl7Ack({
      inboundMessage: req.body,
      ackCode: args.ackCode,
      textMessage: args.textMessage,
    });
    res.status(args.status);
    res.type('text/plain');
    return res.send(ack);
  }
  return res.status(args.status).json(args.jsonBody);
}

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
    if (source === 'yardi-hl7') {
      return sendYardiHl7Response(req, res, {
        status: 400,
        ackCode: 'AE',
        jsonBody: {
          error: 'Invalid payload',
          details: error instanceof Error ? error.message : 'schema_parse_failed',
        },
        textMessage: error instanceof Error ? error.message : 'schema_parse_failed',
      });
    }
    return res.status(400).json({
      error: 'Invalid payload',
      details: error instanceof Error ? error.message : 'schema_parse_failed',
    });
  }

  let eventLog: { id: number };
  let company: { id: number };
  let isDuplicate: boolean;
  try {
    ({ eventLog, company, isDuplicate } = await recordIncomingEvent(event));
  } catch (error) {
    if (source === 'yardi-hl7') {
      logger.error(
        {
          source,
          error: error instanceof Error ? error.message : String(error),
        },
        'webhook_record_failed',
      );
      return sendYardiHl7Response(req, res, {
        status: 500,
        ackCode: 'AR',
        jsonBody: {
          error: 'Internal error',
          details: error instanceof Error ? error.message : String(error),
        },
        textMessage: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }

  if (isDuplicate) {
    if (source === 'yardi-hl7') {
      return sendYardiHl7Response(req, res, {
        status: 200,
        ackCode: 'AA',
        jsonBody: { status: 'duplicate' },
      });
    }
    return res.status(200).json({ status: 'duplicate' });
  }

  if (!adapter.supportsEventType(event.eventType)) {
    await recordEventIssue({
      eventLogId: eventLog.id,
      companyId: company.id,
      source: event.source,
      eventType: event.eventType,
      eventMessageId: event.eventMessageId,
      communityId: event.communityId ?? null,
      stage: 'webhook_ignored',
      severity: 'info',
      message: `Unsupported event type ${event.eventType as string}`,
      details: { payload: event },
      retryable: false,
    });
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
    await recordEventIssue({
      eventLogId: eventLog.id,
      companyId: company.id,
      source: event.source,
      eventType: event.eventType,
      eventMessageId: event.eventMessageId,
      communityId: event.communityId ?? null,
      stage: 'webhook_ignored',
      severity: 'info',
      message: 'Test event acknowledged',
      details: { payload: event },
      retryable: false,
    });
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

  if (source === 'yardi-hl7') {
    await markEventIgnored(
      {
        companyId: company.id,
        eventType: event.eventType,
        eventMessageId: event.eventMessageId,
        source: event.source,
      },
      'capture_only',
    );
    logger.info(
      {
        eventMessageId: event.eventMessageId,
        eventType: event.eventType,
        source,
        companyId: company.id,
      },
      'webhook_event_captured',
    );
    return sendYardiHl7Response(req, res, {
      status: 202,
      ackCode: 'AA',
      jsonBody: { status: 'received', id: eventLog.id },
    });
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
    await recordEventIssue({
      eventLogId: eventLog.id,
      companyId: company.id,
      source: event.source,
      eventType: event.eventType,
      eventMessageId: event.eventMessageId,
      communityId: event.communityId ?? null,
      stage: 'queue_enqueue',
      severity: 'error',
      message: queueError instanceof Error ? queueError.message : String(queueError),
      details: errorToIssueDetails(queueError),
      retryable: true,
    });
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
