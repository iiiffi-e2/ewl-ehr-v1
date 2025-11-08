import type { Resident } from '@prisma/client';

import { prisma } from '../db/prisma.js';

export type NormalizedResidentData = {
  alisResidentId: number;
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
};

export async function upsertResident(
  companyId: number,
  data: NormalizedResidentData,
): Promise<Resident> {
  return prisma.resident.upsert({
    where: { alisResidentId: data.alisResidentId },
    create: {
      companyId,
      ...data,
    },
    update: {
      companyId,
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
    },
  });
}
