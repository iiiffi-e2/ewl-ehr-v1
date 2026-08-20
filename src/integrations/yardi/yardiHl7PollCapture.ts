import { logger } from '../../config/logger.js';
import { markEventIgnored, markEventQueued, recordIncomingEvent } from '../../domains/events.js';
import { processAlisEventQueue } from '../../workers/queue.js';
import type { ProcessAlisEventJobData } from '../../workers/types.js';
import { YardiHl7AdtAdapter } from '../ehr/yardiHl7AdtAdapter.js';
import type { YardiHl7BrokerClient } from './yardiHl7BrokerClient.js';
import {
  getConfiguredYardiHl7PollTargets,
  resolveYardiHl7Facility,
  type YardiHl7PollTarget,
} from './yardiHl7PollConfig.js';
import { isSupportedYardiHl7EventType } from './yardiHl7Triggers.js';

export type DrainYardiHl7MailboxArgs = {
  client: Pick<YardiHl7BrokerClient, 'getMessage' | 'processAck'>;
  maxMessages: number;
  adapter?: YardiHl7AdtAdapter;
  resolveFacility?: (
    facilityId: string | null | undefined,
  ) => YardiHl7PollTarget | null;
  enqueueJob?: (data: ProcessAlisEventJobData) => Promise<void>;
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
  const resolveFacility =
    args.resolveFacility ??
    ((facilityId: string | null | undefined) =>
      resolveYardiHl7Facility(facilityId, getConfiguredYardiHl7PollTargets()));
  const enqueueJob =
    args.enqueueJob ??
    (async (data: ProcessAlisEventJobData) => {
      await processAlisEventQueue.add('process-alis-event', data, {
        jobId: `event-yardi-hl7-${data.eventType}-${data.eventMessageId}`,
        removeOnComplete: true,
        removeOnFail: false,
      });
    });
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
      const detail = result.detail ?? 'unknown';
      logger.warn(
        {
          detail,
          attempt: i + 1,
          consecutiveErrors,
        },
        'yardi_hl7_get_message_error',
      );
      // Only transport failures are worth retrying in-tick (e.g. ECONNRESET while
      // clearing a stuck message). Application ACKs like MSA|CE are stable
      // rejections — retrying them just amplifies noise.
      const isTransient = detail.startsWith('network_');
      if (!isTransient || consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(
          isTransient
            ? `Yardi HL7 broker error: ${detail} (after ${consecutiveErrors} consecutive errors)`
            : `Yardi HL7 broker error: ${detail}`,
        );
      }
      continue;
    }

    consecutiveErrors = 0;

    const event = adapter.parseInboundEvent(result.hl7);
    const sendingFacility = event.notificationData.SendingFacility;
    const pv1Facility = event.notificationData.Pv1Facility;
    const facilityId =
      typeof sendingFacility === 'string' && sendingFacility.trim().length > 0
        ? sendingFacility
        : typeof pv1Facility === 'string'
          ? pv1Facility
          : null;
    const target = resolveFacility(facilityId);
    if (target) {
      event.companyKey = target.companyKey;
      event.communityId = target.communityId;
    }
    event.notificationData.Message = result.hl7;

    const { eventLog, company, isDuplicate } = await recordIncomingEvent(event);

    if (isDuplicate) {
      duplicates += 1;
    } else {
      const identity = {
        companyId: company.id,
        eventType: event.eventType,
        eventMessageId: event.eventMessageId,
        source: event.source,
      };

      if (!target) {
        await markEventIgnored(identity, 'unknown_facility');
      } else if (!isSupportedYardiHl7EventType(event.eventType)) {
        await markEventIgnored(identity, 'unsupported_trigger');
      } else {
        const job: ProcessAlisEventJobData = {
          source: event.source,
          eventMessageId: event.eventMessageId,
          eventType: event.eventType,
          companyKey: event.companyKey,
          companyId: company.id,
          communityId: event.communityId,
          notificationData: event.notificationData,
          eventMessageDate: event.eventMessageDate,
        };
        await enqueueJob(job);
        await markEventQueued(identity);
      }

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
