# ALIS Communities API Integration

## Overview

This document describes the implementation of the ALIS Communities API endpoint integration, as suggested by the ALIS representative.

## What Was Added

### 1. Type Definition: `AlisCommunity`

Added a new TypeScript type in `src/integrations/alisClient.ts`:

```typescript
export type AlisCommunity = {
  CommunityId?: number;
  communityId?: number;
  CommunityName?: string;
  communityName?: string;
  CompanyKey?: string;
  companyKey?: string;
  Address?: string;
  address?: string;
  City?: string;
  city?: string;
  State?: string;
  state?: string;
  ZipCode?: string;
  zipCode?: string;
  Phone?: string;
  phone?: string;
};
```

This type follows the same pattern as other ALIS types in the codebase, supporting both PascalCase and camelCase property names to handle API response variations.

### 2. AlisClient Method: `getCommunities()`

Added a new method to the AlisClient that fetches communities from the ALIS API:

```typescript
async getCommunities(): Promise<AlisCommunity[]> {
  try {
    const response = await http.get<AlisCommunity[]>('/v1/integration/communities');
    return response.data;
  } catch (error) {
    throw mapAlisError(error, 'getCommunities');
  }
}
```

The existing `listCommunities()` method was updated to return `AlisCommunity[]` and now calls `getCommunities()` internally for backward compatibility.

### 3. Test Script: `testCommunities.ts`

Created a new test script at `src/scripts/testCommunities.ts` that:

- Connects to the ALIS API using sandbox credentials
- Fetches all communities via the `getCommunities()` method
- Displays detailed community information in a user-friendly format
- Logs structured output for debugging purposes
- Provides clear success/error feedback

### 4. NPM Script

Added a convenient npm script to run the test:

```bash
npm run test:communities
```

### 5. Documentation

Updated `README.md` with:
- New script entry in the NPM Scripts table
- Dedicated section explaining how to test the Communities API
- Description of what the test script does and what data it returns

## Usage

### Running the Test

Simply run:

```bash
npm run test:communities
```

This will:
1. Load ALIS credentials from your `.env` file
2. Connect to the ALIS API
3. Fetch all communities
4. Display the results in both structured logs and console output

### Using in Code

The `getCommunities()` method is now available on any AlisClient instance:

```typescript
import { createAlisClient } from './integrations/alisClient.js';

const credentials = {
  username: 'your-username',
  password: 'your-password'
};

const client = createAlisClient(credentials);
const communities = await client.getCommunities();

// communities is typed as AlisCommunity[]
communities.forEach(community => {
  console.log(community.CommunityName ?? community.communityName);
});
```

## API Endpoint

The implementation calls:
```
GET /v1/integration/communities
```

## Error Handling

The method uses the same error handling pattern as other AlisClient methods:
- Network errors are caught and mapped to `AlisApiError`
- 401/403 responses are properly identified
- All errors include appropriate context for debugging

## Benefits

1. **Type Safety**: Full TypeScript support for community data
2. **Consistency**: Follows existing patterns in the codebase
3. **Testing**: Easy-to-run script for verifying API connectivity
4. **Documentation**: Clear documentation for future developers
5. **Backward Compatibility**: Existing `listCommunities()` method still works

## Files Modified

- `src/integrations/alisClient.ts` - Added type and method
- `src/scripts/testCommunities.ts` - New test script
- `package.json` - Added npm script
- `README.md` - Updated documentation
- `COMMUNITIES_API.md` - This documentation file

## Next Steps

You can now:
1. Run `npm run test:communities` to verify the API works
2. Use `getCommunities()` in your application code
3. Integrate community data into your workflow as needed
4. Add community filtering/selection features based on the returned data

