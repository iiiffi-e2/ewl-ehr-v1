import path from 'node:path';

import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import {
  createAlisClient,
  resolveAlisCredentials,
  type ListResidentsParams,
} from '../integrations/alisClient.js';
import { buildCaspioPayload, normalizeResident } from '../integrations/mappers.js';
import { sendResidentToCaspio } from '../integrations/caspioClient.js';
import { upsertResident } from '../domains/residents.js';

type BackfillOptions = {
  companyKey: string;
  communityId?: number;
  pageSize: number;
  dryRun: boolean;
  skipCaspio: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const company = await prisma.company.upsert({
    where: { companyKey: options.companyKey },
    update: {},
    create: { companyKey: options.companyKey },
  });

  const credentials = await resolveAlisCredentials(company.id, options.companyKey);
  const alisClient = createAlisClient(credentials);

  let page = 1;
  let processed = 0;
  let hasMore = true;

  while (hasMore) {
    const params: ListResidentsParams = {
      companyKey: options.companyKey,
      communityId: options.communityId,
      page,
      pageSize: options.pageSize,
    };

    const { residents, hasMore: nextPage } = await alisClient.listResidents(params);

    if (!residents.length) {
      break;
    }

    for (const resident of residents) {
      const residentId = resident.ResidentId ?? resident.residentId;
      if (!residentId) {
        logger.warn({ message: 'Skipping resident without ResidentId' }, 'backfill_skip_record');
        continue;
      }

      const [detail, basicInfo] = await Promise.all([
        alisClient.getResident(residentId),
        alisClient.getResidentBasicInfo(residentId),
      ]);

      const normalized = normalizeResident({ detail, basicInfo });

      if (options.dryRun) {
        logger.info(
          { residentId: normalized.alisResidentId, status: normalized.status },
          'backfill_dry_run_resident',
        );
        processed += 1;
        continue;
      }

      await upsertResident(company.id, normalized);

      if (!options.skipCaspio) {
        const payload = buildCaspioPayload({
          resident: normalized,
          companyKey: options.companyKey,
          communityId: options.communityId ?? null,
          eventType: 'backfill.resident',
          eventMessageId: `backfill-${options.companyKey}-${normalized.alisResidentId}`,
          eventTimestamp: new Date().toISOString(),
          leave: null,
        });

        await sendResidentToCaspio(payload);

        await delay(250);
      }

      processed += 1;
    }

    page += 1;
    hasMore = nextPage;
  }

  logger.info(
    { companyKey: options.companyKey, processed, dryRun: options.dryRun },
    'backfill_completed',
  );
}

function parseArgs(args: string[]): BackfillOptions {
  const lookup = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        flags.add(key);
      } else {
        lookup.set(key, next);
        i += 1;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (!next || next.startsWith('-')) {
        flags.add(key);
      } else {
        lookup.set(key, next);
        i += 1;
      }
    }
  }

  const companyKey =
    lookup.get('companyKey') ||
    lookup.get('c') ||
    (() => {
      throw new Error('--companyKey is required');
    })();

  const pageSize = Number(lookup.get('pageSize') ?? 50);
  const communityId = lookup.has('communityId') ? Number(lookup.get('communityId')) : undefined;

  return {
    companyKey,
    communityId: Number.isFinite(communityId) ? communityId : undefined,
    pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    dryRun: flags.has('dryRun') || flags.has('dry-run'),
    skipCaspio: flags.has('skipCaspio') || flags.has('skip-caspio'),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isMainModule =
  import.meta.url ===
  pathToFileUrl(process.argv[1] ?? '').href;

function pathToFileUrl(filePath: string): URL {
  if (filePath.startsWith('file://')) {
    return new URL(filePath);
  }
  return new URL(`file://${path.resolve(filePath)}`);
}

if (isMainModule) {
  main()
    .catch((error) => {
      logger.error({ error }, 'backfill_failed');
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
