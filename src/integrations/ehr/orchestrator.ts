import { handleAlisEvent } from '../caspio/eventOrchestrator.js';
import { canonicalToAlisEvent } from './alisAdapter.js';
import { pushYardiFhirBundleToCaspio } from '../yardi/yardiFhirSync.js';
import type { CanonicalEventOrchestrationInput } from './types.js';

export async function handleEhrEvent(input: CanonicalEventOrchestrationInput): Promise<void> {
  if (input.source === 'alis') {
    const event = input.legacyAlisEvent ?? canonicalToAlisEvent(input.event);
    await handleAlisEvent(event, input.companyId, input.companyKey);
    return;
  }

  if (input.source === 'yardi-fhir') {
    if (!input.residentBundle) {
      throw new Error('Yardi FHIR event orchestration requires residentBundle');
    }
    if (input.residentBundle.communityId === null) {
      throw new Error('Yardi FHIR event orchestration requires communityId');
    }
    await pushYardiFhirBundleToCaspio(input.residentBundle, input.residentBundle.communityId);
    return;
  }

  throw new Error(`No event orchestrator implemented for source '${input.source}'`);
}
