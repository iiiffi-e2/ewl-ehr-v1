import type { Resident } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import type { EhrSource } from '../integrations/ehr/types.js';

export type NormalizedResidentData = {
  source: EhrSource;
  externalResidentId: string;
  alisResidentId?: number | null;
  status: string;
  productType?: string | null;
  classification?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: Date | null;
  roomNumber?: string | null;
  bed?: string | null;
  room?: string | null;
  updatedAtUtc?: Date | null;
  onPrem?: boolean | null;
  onPremDate?: Date | null;
  offPrem?: boolean | null;
  offPremDate?: Date | null;
};

export async function upsertResident(
  companyId: number,
  data: NormalizedResidentData,
): Promise<Resident> {
  return prisma.resident.upsert({
    where: {
      companyId_source_externalResidentId: {
        companyId,
        source: data.source,
        externalResidentId: data.externalResidentId,
      },
    },
    create: {
      companyId,
      ...data,
    },
    update: {
      companyId,
      source: data.source,
      externalResidentId: data.externalResidentId,
      alisResidentId: data.alisResidentId ?? null,
      status: data.status,
      productType: data.productType ?? null,
      classification: data.classification ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      roomNumber: data.roomNumber ?? null,
      bed: data.bed ?? null,
      room: data.room ?? null,
      updatedAtUtc: data.updatedAtUtc ?? null,
      onPrem: data.onPrem ?? null,
      onPremDate: data.onPremDate ?? null,
      offPrem: data.offPrem ?? null,
      offPremDate: data.offPremDate ?? null,
    },
  });
}
