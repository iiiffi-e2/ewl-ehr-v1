import path from 'node:path';

import { logger } from '../config/logger.js';
import { createAlisClient, type AlisCredentials } from '../integrations/alisClient.js';
import { env } from '../config/env.js';

async function main(): Promise<void> {
  logger.info('Testing ALIS Communities API endpoint...');

  const credentials: AlisCredentials = {
    username: env.ALIS_TEST_USERNAME,
    password: env.ALIS_TEST_PASSWORD,
  };

  const alisClient = createAlisClient(credentials);

  try {
    const communities = await alisClient.getCommunities();

    logger.info(
      {
        count: communities.length,
        communities: communities.map((c) => ({
          id: c.CommunityId ?? c.communityId,
          name: c.CommunityName ?? c.communityName,
          companyKey: c.CompanyKey ?? c.companyKey,
          city: c.City ?? c.city,
          state: c.State ?? c.state,
        })),
      },
      'communities_fetched_successfully',
    );

    console.log('\n✅ Successfully fetched communities from ALIS API');
    console.log(`📊 Total communities: ${communities.length}\n`);

    if (communities.length > 0) {
      console.log('Communities:');
      communities.forEach((community, index) => {
        const id = community.CommunityId ?? community.communityId;
        const name = community.CommunityName ?? community.communityName;
        const companyKey = community.CompanyKey ?? community.companyKey;
        const city = community.City ?? community.city;
        const state = community.State ?? community.state;
        const address = community.Address ?? community.address;
        const phone = community.Phone ?? community.phone;

        console.log(`\n${index + 1}. ${name || 'Unnamed Community'}`);
        console.log(`   ID: ${id}`);
        if (companyKey) console.log(`   Company Key: ${companyKey}`);
        if (address) console.log(`   Address: ${address}`);
        if (city || state) console.log(`   Location: ${city || ''}${city && state ? ', ' : ''}${state || ''}`);
        if (phone) console.log(`   Phone: ${phone}`);
      });
    } else {
      console.log('⚠️  No communities found in the response.');
    }
  } catch (error) {
    logger.error({ error }, 'failed_to_fetch_communities');
    console.error('\n❌ Failed to fetch communities from ALIS API');
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    throw error;
  }
}

const isMainModule = import.meta.url === pathToFileUrl(process.argv[1] ?? '').href;

function pathToFileUrl(filePath: string): URL {
  if (filePath.startsWith('file://')) {
    return new URL(filePath);
  }
  return new URL(`file://${path.resolve(filePath)}`);
}

if (isMainModule) {
  main()
    .then(() => {
      console.log('\n✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'test_communities_failed');
      console.error('\n❌ Test failed');
      process.exit(1);
    });
}

