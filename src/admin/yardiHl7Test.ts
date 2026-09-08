import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { markEventIgnored, markEventQueued, recordIncomingEvent } from '../domains/events.js';
import { YardiHl7AdtAdapter } from '../integrations/ehr/yardiHl7AdtAdapter.js';
import { getCommunityEnrichment } from '../integrations/caspio/caspioCommunityEnrichment.js';
import {
  getRecordedCaspioOperations,
  runWithCaspioWriteRecorder,
} from '../integrations/caspio/caspioWriteRecorder.js';
import type { CaspioRecordedOperation } from '../integrations/caspio/caspioWriteRecorder.js';
import {
  getConfiguredYardiHl7PollTargets,
  resolveYardiHl7Facility,
} from '../integrations/yardi/yardiHl7PollConfig.js';
import {
  isSupportedYardiHl7EventType,
  isSupportedYardiHl7Trigger,
  labelForYardiHl7Trigger,
  SUPPORTED_YARDI_HL7_TRIGGERS,
} from '../integrations/yardi/yardiHl7Triggers.js';
import {
  buildYardiHl7Adt,
  extractYardiHl7FromEventPayload,
  remintYardiHl7MessageControlId,
} from '../integrations/yardi/yardiHl7TestMessage.js';
import { processAlisEventJob } from '../workers/processAlisEvent.js';
import { processAlisEventQueue } from '../workers/queue.js';
import type { ProcessAlisEventJobData } from '../workers/types.js';

export class YardiHl7TestValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'YardiHl7TestValidationError';
  }
}

export type YardiHl7TestMode = 'inline' | 'dry-run' | 'enqueue';
export type YardiHl7TestSource = 'form' | 'hl7' | 'eventLog';
export type YardiHl7SkipReason =
  | null
  | 'dry_run'
  | 'unknown_facility'
  | 'unsupported_trigger'
  | 'ehr_adapter_disabled'
  | 'ehr_community_not_enabled'
  | 'ehr_shadow_mode'
  | 'missing_cuid';

export type YardiHl7TestConfig = {
  pollEnabled: boolean;
  pollIntervalMs: number;
  targets: ReturnType<typeof getConfiguredYardiHl7PollTargets>;
  sendingFacility: string;
  supportedTriggers: string[];
  triggerLabels: Record<string, string>;
  caspioPatientTable: string;
  caspioCommunityTable: string;
  caspioServiceTable: string;
  ehrAdapterEnabled: boolean;
  ehrShadowMode: boolean;
  ehrEnabledCommunityIds: number[];
};

export type YardiHl7TestInput = {
  mode?: YardiHl7TestMode;
  source: YardiHl7TestSource;
  enqueue?: boolean;
  trigger?: string;
  residentId?: string;
  roomNumber?: string;
  facilityId?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  hl7?: string;
  eventLogId?: number;
  eventMessageId?: string;
};

export type YardiHl7TestResult = {
  success: boolean;
  mode: YardiHl7TestMode;
  event: {
    id: number;
    eventMessageId: string;
    eventType: string;
    status: string;
    companyKey: string;
    communityId: number | null;
  };
  parsed: {
    trigger: string;
    residentId: string | null;
    roomNumber: string | null;
    facilityId: string | null;
  };
  enrichment: { CUID?: string; communityName?: string };
  caspio: {
    wrote: boolean;
    skipReason: YardiHl7SkipReason;
    operations: CaspioRecordedOperation[];
  };
  issues: Array<{ stage: string; severity: string; message: string }>;
  hl7: string;
  jobId: string | null;
};

export function getYardiHl7TestConfig(): YardiHl7TestConfig {
  return {
    pollEnabled: env.YARDI_HL7_POLL_ENABLED,
    pollIntervalMs: env.YARDI_HL7_POLL_INTERVAL_MS,
    targets: getConfiguredYardiHl7PollTargets(),
    sendingFacility: env.YARDI_HL7_SENDING_FACILITY,
    supportedTriggers: [...SUPPORTED_YARDI_HL7_TRIGGERS],
    triggerLabels: Object.fromEntries(
      [...SUPPORTED_YARDI_HL7_TRIGGERS].map((code) => [code, labelForYardiHl7Trigger(code)]),
    ),
    caspioPatientTable: env.CASPIO_TABLE_NAME,
    caspioCommunityTable: env.CASPIO_COMMUNITY_TABLE_NAME,
    caspioServiceTable: env.CASPIO_SERVICE_TABLE_NAME,
    ehrAdapterEnabled: env.EHR_ADAPTER_ENABLED,
    ehrShadowMode: env.EHR_SHADOW_MODE,
    ehrEnabledCommunityIds: env.ehrEnabledCommunityIds,
  };
}

function resolveMode(input: YardiHl7TestInput): YardiHl7TestMode {
  const mode = input.mode ?? 'inline';
  if (mode !== 'inline' && mode !== 'dry-run' && mode !== 'enqueue') {
    throw new YardiHl7TestValidationError('mode must be inline, dry-run, or enqueue');
  }
  if (mode === 'dry-run' && input.enqueue) {
    throw new YardiHl7TestValidationError('dry-run cannot be combined with enqueue');
  }
  if (input.enqueue && mode === 'inline') {
    return 'enqueue';
  }
  return mode;
}

async function resolveHl7(input: YardiHl7TestInput): Promise<string> {
  if (input.source === 'form') {
    const trigger = (input.trigger ?? '').trim().toUpperCase();
    if (!isSupportedYardiHl7Trigger(trigger)) {
      throw new YardiHl7TestValidationError('form trigger must be a supported ADT code');
    }
    const residentId = (input.residentId ?? '').trim();
    const roomNumber = (input.roomNumber ?? '').trim();
    if (!residentId || !roomNumber) {
      throw new YardiHl7TestValidationError('form source requires residentId and roomNumber');
    }
    const targets = getConfiguredYardiHl7PollTargets();
    let facilityId = (input.facilityId ?? '').trim();
    if (!facilityId && targets.length === 1) {
      facilityId = targets[0]!.facilityId;
    }
    if (!facilityId) {
      throw new YardiHl7TestValidationError('form source requires facilityId');
    }
    return buildYardiHl7Adt({
      trigger,
      residentId,
      roomNumber,
      facilityId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
    });
  }
  if (input.source === 'hl7') {
    const hl7 = (input.hl7 ?? '').trim();
    if (!hl7.startsWith('MSH|')) {
      throw new YardiHl7TestValidationError('hl7 source requires a message starting with MSH|');
    }
    return hl7;
  }
  if (input.source === 'eventLog') {
    const row = input.eventLogId
      ? await prisma.eventLog.findFirst({ where: { id: input.eventLogId } })
      : input.eventMessageId
        ? await prisma.eventLog.findFirst({ where: { eventMessageId: input.eventMessageId } })
        : null;
    if (!row) {
      throw new YardiHl7TestValidationError('EventLog row not found');
    }
    if (row.source !== 'yardi-hl7') {
      throw new YardiHl7TestValidationError('EventLog replay is only supported for yardi-hl7');
    }
    const extracted = extractYardiHl7FromEventPayload(row.payload);
    if (!extracted) {
      throw new YardiHl7TestValidationError('EventLog row has no extractable HL7 Message');
    }
    return extracted;
  }
  throw new YardiHl7TestValidationError('source must be form, hl7, or eventLog');
}

function skipReasonForGates(communityId: number | null): YardiHl7SkipReason {
  if (!env.EHR_ADAPTER_ENABLED) return 'ehr_adapter_disabled';
  if (
    env.ehrEnabledCommunityIds.length > 0 &&
    (communityId === null || !env.ehrEnabledCommunityIds.includes(communityId))
  ) {
    return 'ehr_community_not_enabled';
  }
  if (env.EHR_SHADOW_MODE) return 'ehr_shadow_mode';
  return null;
}

export async function runYardiHl7Test(input: YardiHl7TestInput): Promise<YardiHl7TestResult> {
  const mode = resolveMode(input);
  const rawHl7 = await resolveHl7(input);
  const reminted = remintYardiHl7MessageControlId(rawHl7);
  const adapter = new YardiHl7AdtAdapter();
  const event = adapter.parseInboundEvent(reminted.hl7);
  event.notificationData.Message = reminted.hl7;

  const sendingFacility =
    typeof event.notificationData.SendingFacility === 'string'
      ? event.notificationData.SendingFacility
      : null;
  const pv1Facility =
    typeof event.notificationData.Pv1Facility === 'string' ? event.notificationData.Pv1Facility : null;
  const facilityId = sendingFacility?.trim() || pv1Facility;
  const target = resolveYardiHl7Facility(facilityId, getConfiguredYardiHl7PollTargets());
  if (target) {
    event.companyKey = target.companyKey;
    event.communityId = target.communityId;
  }

  const recorded = await recordIncomingEvent(event);
  const identity = {
    companyId: recorded.company.id,
    eventType: event.eventType,
    eventMessageId: event.eventMessageId,
    source: event.source,
  };
  const job: ProcessAlisEventJobData = {
    source: event.source,
    eventMessageId: event.eventMessageId,
    eventType: event.eventType,
    companyKey: event.companyKey,
    companyId: recorded.company.id,
    communityId: event.communityId,
    notificationData: event.notificationData,
    eventMessageDate: event.eventMessageDate,
  };

  let operations: CaspioRecordedOperation[] = [];
  let skipReason: YardiHl7SkipReason = null;
  let jobId: string | null = null;
  let success = true;

  if (!target) {
    await markEventIgnored(identity, 'unknown_facility');
    skipReason = 'unknown_facility';
    success = false;
  } else if (!isSupportedYardiHl7EventType(event.eventType)) {
    await markEventIgnored(identity, 'unsupported_trigger');
    skipReason = 'unsupported_trigger';
    success = false;
  } else if (mode === 'enqueue') {
    const added = await processAlisEventQueue.add('process-alis-event', job, {
      jobId: `event-yardi-hl7-${job.eventType}-${job.eventMessageId}`,
      removeOnComplete: true,
      removeOnFail: false,
    });
    await markEventQueued(identity);
    jobId = added.id ? String(added.id) : `event-yardi-hl7-${job.eventType}-${job.eventMessageId}`;
  } else {
    try {
      const recordedWrites = await runWithCaspioWriteRecorder(
        { dryRun: mode === 'dry-run' },
        async () => {
          await processAlisEventJob(job);
        },
      );
      operations = recordedWrites.operations;
      if (mode === 'dry-run') {
        await markEventIgnored(identity, 'dry_run');
        skipReason = 'dry_run';
      } else if (operations.length === 0) {
        const gate = skipReasonForGates(event.communityId ?? null);
        if (gate) skipReason = gate;
        const issues = await prisma.eventProcessingIssue.findMany({
          where: {
            companyId: recorded.company.id,
            eventMessageId: event.eventMessageId,
          },
        });
        if (issues.some((issue) => /cuid/i.test(issue.message))) {
          skipReason = 'missing_cuid';
        }
      }
    } catch (error) {
      success = false;
      operations = getRecordedCaspioOperations(error);
      const reloadedFailed = await prisma.eventLog.findUnique({
        where: {
          companyId_source_eventType_eventMessageId: {
            companyId: recorded.company.id,
            source: event.source,
            eventType: event.eventType,
            eventMessageId: event.eventMessageId,
          },
        },
        include: { company: { select: { companyKey: true } } },
      });
      const failedIssues = await prisma.eventProcessingIssue.findMany({
        where: { companyId: recorded.company.id, eventMessageId: event.eventMessageId },
      });
      return {
        success: false,
        mode,
        event: {
          id: reloadedFailed?.id ?? recorded.eventLog.id,
          eventMessageId: event.eventMessageId,
          eventType: event.eventType,
          status: reloadedFailed?.status ?? 'failed',
          companyKey: reloadedFailed?.company.companyKey ?? recorded.company.companyKey,
          communityId: reloadedFailed?.communityId ?? event.communityId ?? null,
        },
        parsed: {
          trigger: String(event.notificationData.TriggerEvent ?? ''),
          residentId:
            event.notificationData.ResidentId == null
              ? null
              : String(event.notificationData.ResidentId),
          roomNumber:
            typeof event.notificationData.RoomNumber === 'string'
              ? event.notificationData.RoomNumber
              : null,
          facilityId: facilityId ?? null,
        },
        enrichment: {},
        caspio: { wrote: false, skipReason: mode === 'dry-run' ? 'dry_run' : null, operations },
        issues: failedIssues.map((issue) => ({
          stage: issue.stage,
          severity: issue.severity,
          message: issue.message,
        })),
        hl7: reminted.hl7,
        jobId: null,
      };
    }
  }

  const roomNumber =
    typeof event.notificationData.RoomNumber === 'string' ? event.notificationData.RoomNumber : null;
  let enrichment: { CUID?: string; communityName?: string } = {};
  if (event.communityId != null) {
    try {
      const row = await getCommunityEnrichment(event.communityId, roomNumber ?? undefined);
      enrichment = { CUID: row.CUID, communityName: row.CommunityName };
    } catch {
      enrichment = {};
    }
  }

  const reloaded = await prisma.eventLog.findUnique({
    where: {
      companyId_source_eventType_eventMessageId: {
        companyId: recorded.company.id,
        source: event.source,
        eventType: event.eventType,
        eventMessageId: event.eventMessageId,
      },
    },
    include: { company: { select: { companyKey: true } } },
  });
  const issues = await prisma.eventProcessingIssue.findMany({
    where: { companyId: recorded.company.id, eventMessageId: event.eventMessageId },
    orderBy: { createdAt: 'asc' },
  });

  if (reloaded?.status === 'failed') {
    success = false;
  }

  const wrote = mode === 'inline' && operations.length > 0 && skipReason === null;

  return {
    success,
    mode,
    event: {
      id: reloaded?.id ?? recorded.eventLog.id,
      eventMessageId: event.eventMessageId,
      eventType: event.eventType,
      status: reloaded?.status ?? recorded.eventLog.status,
      companyKey: reloaded?.company.companyKey ?? recorded.company.companyKey,
      communityId: reloaded?.communityId ?? event.communityId ?? null,
    },
    parsed: {
      trigger: String(event.notificationData.TriggerEvent ?? ''),
      residentId:
        event.notificationData.ResidentId === null || event.notificationData.ResidentId === undefined
          ? null
          : String(event.notificationData.ResidentId),
      roomNumber,
      facilityId: facilityId ?? null,
    },
    enrichment,
    caspio: {
      wrote,
      skipReason,
      operations: mode === 'enqueue' ? [] : operations,
    },
    issues: issues.map((issue) => ({
      stage: issue.stage,
      severity: issue.severity,
      message: issue.message,
    })),
    hl7: reminted.hl7,
    jobId,
  };
}
