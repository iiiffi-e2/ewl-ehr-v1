import { logger } from '../../config/logger.js';
import { markEventIgnored, recordIncomingEvent } from '../../domains/events.js';
import { YardiHl7AdtAdapter } from '../ehr/yardiHl7AdtAdapter.js';
import type { YardiHl7BrokerClient } from './yardiHl7BrokerClient.js';

export type DrainYardiHl7MailboxArgs = {
  client: Pick<YardiHl7BrokerClient, 'getMessage' | 'processAck'>;
  maxMessages: number;
  adapter?: YardiHl7AdtAdapter;
  /**
   * How many consecutive GetMessage errors to tolerate within a single drain
   * before giving up. Yardi's broker serves oldest-first and a stuck message
   * can cause a single connection reset before the next request succeeds, so
   * we retry a couple of times in-tick rather than aborting on the first error.
   */
  maxConsecutiveErrors?: number;
};

export type DrainYardiHl7MailboxSummary = {
  captured: number;
  duplicates: number;
  errors: number;
  empty: boolean;
};

export async function drainYardiHl7Mailbox(
  args: DrainYardiHl7MailboxArgs,
): Promise<DrainYardiHl7MailboxSummary> {
  const adapter = args.adapter ?? new YardiHl7AdtAdapter();
  const maxConsecutiveErrors = args.maxConsecutiveErrors ?? 3;
  let captured = 0;
  let duplicates = 0;
  let errors = 0;
  let consecutiveErrors = 0;
  let empty = false;

  for (let i = 0; i < args.maxMessages; i += 1) {
    const result = await args.client.getMessage();
    if (result.kind === 'empty') {
      empty = true;
      break;
    }
    if (result.kind === 'error') {
      errors += 1;
      consecutiveErrors += 1;
      logger.warn(
        {
          detail: result.detail ?? 'unknown',
          attempt: i + 1,
          consecutiveErrors,
        },
        'yardi_hl7_get_message_error',
      );
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(
          `Yardi HL7 broker error: ${result.detail ?? 'unknown'} ` +
            `(after ${consecutiveErrors} consecutive errors)`,
        );
      }
      continue;
    }

    consecutiveErrors = 0;

    const event = adapter.parseInboundEvent(result.hl7);
    const { eventLog, company, isDuplicate } = await recordIncomingEvent(event);

    if (isDuplicate) {
      duplicates += 1;
    } else {
      await markEventIgnored(
        {
          companyId: company.id,
          eventType: event.eventType,
          eventMessageId: event.eventMessageId,
          source: event.source,
        },
        'capture_only',
      );
      captured += 1;
      logger.info(
        {
          eventMessageId: event.eventMessageId,
          eventType: event.eventType,
          eventLogId: eventLog.id,
        },
        'yardi_hl7_message_captured',
      );
    }

    try {
      await args.client.processAck(result.hl7);
    } catch (ackError) {
      logger.warn(
        {
          eventMessageId: event.eventMessageId,
          error: ackError instanceof Error ? ackError.message : String(ackError),
        },
        'yardi_hl7_process_ack_failed',
      );
    }
  }

  return { captured, duplicates, errors, empty };
}
