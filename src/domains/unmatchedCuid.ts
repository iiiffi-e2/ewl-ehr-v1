import type { UnmatchedCuid } from '@prisma/client';

import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { errorToIssueDetails, recordEventIssue } from './eventIssues.js';

export class UnmatchedCuidQueryError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UnmatchedCuidQueryError';
  }
}

export type RecordUnmatchedCuidInput = {
  companyId: number;
  communityId: number;
  externalResidentId: string;
  roomNumber?: string | null;
  source: 'yardi-hl7' | 'yardi-fhir';
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  syntheticCuid: string;
  eventType: string;
  eventMessageId: string;
};

export type UnmatchedCuidListStatus = 'open' | 'resolved' | 'all';
export type UnmatchedCuidRow = UnmatchedCuid;

const uniqueKey = (input: {
  companyId: number;
  communityId: number;
  externalResidentId: string;
  roomNumber: string;
}) => ({
  companyId_communityId_externalResidentId_roomNumber: {
    companyId: input.companyId,
    communityId: input.communityId,
    externalResidentId: input.externalResidentId,
    roomNumber: input.roomNumber,
  },
});

function providedText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseDateOfBirth(value?: string | null): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function recordUnmatchedCuid(input: RecordUnmatchedCuidInput): Promise<void> {
  const externalResidentId = input.externalResidentId.trim();
  if (!externalResidentId) {
    await recordEventIssue({
      companyId: input.companyId,
      source: input.source,
      eventType: input.eventType,
      eventMessageId: input.eventMessageId,
      communityId: input.communityId,
      stage: 'unmatched_cuid_record_failed',
      severity: 'error',
      message: 'Unmatched CUID row skipped because the patient number is blank',
      retryable: false,
    });
    return;
  }

  const roomNumber = input.roomNumber?.trim() ?? '';
  const firstName = providedText(input.firstName);
  const lastName = providedText(input.lastName);
  const dateOfBirth = parseDateOfBirth(input.dateOfBirth);
  const key = {
    companyId: input.companyId,
    communityId: input.communityId,
    externalResidentId,
    roomNumber,
  };

  try {
    const existing = await prisma.unmatchedCuid.findUnique({ where: uniqueKey(key) });
    const refresh: {
      source: string;
      syntheticCuid: string;
      lastSeenAt: Date;
      lastEventType: string;
      lastEventMessageId: string;
      status: string;
      resolvedAt: null;
      firstName?: string;
      lastName?: string;
      dateOfBirth?: Date;
    } = {
      source: input.source,
      syntheticCuid: input.syntheticCuid,
      lastSeenAt: new Date(),
      lastEventType: input.eventType,
      lastEventMessageId: input.eventMessageId,
      status: 'open',
      resolvedAt: null,
    };
    if (firstName) refresh.firstName = firstName;
    if (lastName) refresh.lastName = lastName;
    if (dateOfBirth) refresh.dateOfBirth = dateOfBirth;

    if (!existing) {
      await prisma.unmatchedCuid.create({
        data: {
          ...key,
          ...refresh,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          dateOfBirth,
          firstSeenAt: new Date(),
        },
      });
      return;
    }

    await prisma.unmatchedCuid.update({ where: { id: existing.id }, data: refresh });
  } catch (error) {
    logger.error(
      {
        companyId: input.companyId,
        communityId: input.communityId,
        externalResidentId,
        eventMessageId: input.eventMessageId,
        error: error instanceof Error ? error.message : String(error),
      },
      'unmatched_cuid_record_failed',
    );
    await recordEventIssue({
      companyId: input.companyId,
      source: input.source,
      eventType: input.eventType,
      eventMessageId: input.eventMessageId,
      communityId: input.communityId,
      stage: 'unmatched_cuid_record_failed',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      details: errorToIssueDetails(error),
      retryable: false,
    });
  }
}

export async function listUnmatchedCuids(query: {
  status?: UnmatchedCuidListStatus;
  communityId?: number;
}): Promise<UnmatchedCuidRow[]> {
  const status = query.status ?? 'open';
  if (status !== 'open' && status !== 'resolved' && status !== 'all') {
    throw new UnmatchedCuidQueryError('status must be open, resolved, or all');
  }

  return prisma.unmatchedCuid.findMany({
    where: {
      ...(status === 'all' ? {} : { status }),
      ...(query.communityId === undefined ? {} : { communityId: query.communityId }),
    },
    orderBy: { lastSeenAt: 'desc' },
  });
}

export async function resolveUnmatchedCuid(id: number): Promise<UnmatchedCuidRow | null> {
  const row = await prisma.unmatchedCuid.findUnique({ where: { id } });
  if (!row) return null;
  if (row.status === 'resolved') return row;
  return prisma.unmatchedCuid.update({
    where: { id },
    data: { status: 'resolved', resolvedAt: new Date() },
  });
}