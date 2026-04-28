import { Prisma } from '@prisma/client';

import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';

export type EventIssueSeverity = 'info' | 'warning' | 'error';

export type RecordEventIssueInput = {
  eventLogId?: number | null;
  companyId: number;
  eventType: string;
  eventMessageId: string;
  residentId?: number | null;
  communityId?: number | null;
  stage: string;
  severity: EventIssueSeverity;
  message: string;
  details?: unknown;
  retryable?: boolean;
};

export function errorToIssueDetails(error: unknown): Prisma.InputJsonValue {
  if (error instanceof Error) {
    const details: Record<string, Prisma.InputJsonValue> = {
      name: error.name,
      message: error.message,
      ...extractHttpErrorDetails(error),
    };
    if (error.stack) {
      details.stack = error.stack;
    }
    return details;
  }

  return toJsonValue(error);
}

export async function recordEventIssue(input: RecordEventIssueInput): Promise<void> {
  try {
    const eventLogId = input.eventLogId ?? (await resolveEventLogId(input));

    await prisma.eventProcessingIssue.create({
      data: {
        eventLogId,
        companyId: input.companyId,
        eventType: input.eventType,
        eventMessageId: input.eventMessageId,
        residentId: input.residentId ?? null,
        communityId: input.communityId ?? null,
        stage: input.stage,
        severity: input.severity,
        message: input.message,
        details: input.details === undefined ? undefined : toJsonValue(input.details),
        retryable: input.retryable ?? false,
      },
    });
  } catch (issueError) {
    logger.error(
      {
        eventMessageId: input.eventMessageId,
        eventType: input.eventType,
        stage: input.stage,
        error: issueError instanceof Error ? issueError.message : String(issueError),
      },
      'event_issue_record_failed',
    );
  }
}

async function resolveEventLogId(input: RecordEventIssueInput): Promise<number | null> {
  const eventLog = await prisma.eventLog.findUnique({
    where: {
      companyId_eventType_eventMessageId: {
        companyId: input.companyId,
        eventType: input.eventType,
        eventMessageId: input.eventMessageId,
      },
    },
    select: {
      id: true,
    },
  });

  return eventLog?.id ?? null;
}

function extractHttpErrorDetails(error: Error): Record<string, Prisma.InputJsonValue> {
  if (!('response' in error)) {
    return {};
  }

  const response = (error as { response?: { status?: unknown; data?: unknown } }).response;
  return {
    status: toJsonValue(response?.status),
    responseData: toJsonValue(response?.data),
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) {
    return null as unknown as Prisma.InputJsonValue;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return String(value);
  }
}
