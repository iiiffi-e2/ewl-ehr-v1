import { Job, Worker } from 'bullmq';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import {
  createAlisClient,
  fetchAllResidentData,
  resolveAlisCredentials,
} from '../integrations/alisClient.js';
import { pushToCaspio } from '../integrations/caspio/pushToCaspio.js';
import type { AlisPayload } from '../integrations/alis/types.js';

import { getRedisConnection } from './connection.js';
import { RESIDENT_BACKFILL_QUEUE } from './queue.js';
import type { ResidentBackfillJobData } from './types.js';

type BackfillSummary = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  pageSize: number;
};

export function startResidentBackfillWorker(): Worker<ResidentBackfillJobData> {
  const worker = new Worker<ResidentBackfillJobData>(
    RESIDENT_BACKFILL_QUEUE,
    async (job) => processJob(job),
    {
      connection: getRedisConnection(),
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    logger.error(
      {
        jobId: job.id,
        companyKey: job.data.companyKey,
        communityId: job.data.communityId,
        error: error?.message,
      },
      'resident_backfill_job_failed',
    );
  });

  worker.on('completed', (job) => {
    logger.info(
      {
        jobId: job.id,
        companyKey: job.data.companyKey,
        communityId: job.data.communityId,
      },
      'resident_backfill_job_completed',
    );
  });

  return worker;
}

async function processJob(job: Job<ResidentBackfillJobData>): Promise<BackfillSummary> {
  const { companyKey, communityId, status, pageSize } = job.data;

  logger.info(
    { jobId: job.id, companyKey, communityId, status },
    'resident_backfill_job_started',
  );

  if (!companyKey || !communityId || !status) {
    throw new Error('Missing required job data for resident backfill');
  }

  const company = await prisma.company.findUnique({
    where: { companyKey },
    include: { alisCredential: true },
  });

  if (!company || !company.alisCredential) {
    throw new Error(`ALIS credentials not found for companyKey '${companyKey}'`);
  }

  const credentials = await resolveAlisCredentials(company.id, companyKey);
  const client = createAlisClient(credentials);

  const summary: BackfillSummary = {
    total: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    pageSize: Number.isFinite(pageSize) && pageSize ? pageSize : 100,
  };

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const { residents, hasMore: nextPage } = await client.listResidents({
      companyKey,
      communityId,
      status,
      page,
      pageSize: summary.pageSize,
    });

    if (!residents.length) {
      break;
    }

    for (const resident of residents) {
      summary.total += 1;

      const residentId = Number(resident.ResidentId ?? resident.residentId);
      if (!Number.isFinite(residentId)) {
        summary.skipped += 1;
        logger.warn(
          { companyKey, communityId, resident },
          'resident_backfill_skip_missing_resident_id',
        );
        await job.updateProgress(summary);
        continue;
      }

      try {
        const allData = await fetchAllResidentData(credentials, residentId, communityId);

        const alisPayload: AlisPayload = {
          success: true,
          residentId,
          timestamp: new Date().toISOString(),
          apiBase: env.ALIS_API_BASE,
          data: {
            resident: allData.resident,
            basicInfo: allData.basicInfo,
            insurance: allData.insurance,
            roomAssignments: allData.roomAssignments,
            diagnosesAndAllergies: allData.diagnosesAndAllergies,
            diagnosesAndAllergiesFull: allData.diagnosesAndAllergiesFull,
            contacts: allData.contacts,
            community: allData.community,
          },
          counts: {
            insurance: allData.insurance.length,
            roomAssignments: allData.roomAssignments.length,
            diagnosesAndAllergies: allData.diagnosesAndAllergies.length,
            contacts: allData.contacts.length,
          },
        };

        await pushToCaspio(alisPayload);
        summary.succeeded += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error(
          {
            companyKey,
            communityId,
            residentId,
            error: error instanceof Error ? error.message : String(error),
          },
          'resident_backfill_resident_failed',
        );
      }

      await job.updateProgress(summary);
      await delay(200);
    }

    page += 1;
    hasMore = nextPage;
  }

  logger.info(
    { companyKey, communityId, summary },
    'resident_backfill_job_summary',
  );

  return summary;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
