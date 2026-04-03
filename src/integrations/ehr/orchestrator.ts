import { handleAlisEvent } from '../caspio/eventOrchestrator.js';
import { canonicalToAlisEvent } from './alisAdapter.js';
import type { CanonicalEventOrchestrationInput } from './types.js';

export async function handleEhrEvent(input: CanonicalEventOrchestrationInput): Promise<void> {
  if (input.source === 'alis') {
    const event = input.legacyAlisEvent ?? canonicalToAlisEvent(input.event);
    await handleAlisEvent(event, input.companyId, input.companyKey);
    return;
  }

  throw new Error(`No event orchestrator implemented for source '${input.source}'`);
}
