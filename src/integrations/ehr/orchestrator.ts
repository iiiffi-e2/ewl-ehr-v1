import { handleAlisEvent } from '../caspio/eventOrchestrator.js';
import { handleYardiHl7Event } from '../caspio/yardiHl7EventOrchestrator.js';
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
    const bundle = input.residentBundle;
    if (bundle.communityId === null) {
      throw new Error('Yardi FHIR event orchestration requires communityId');
    }
    await pushYardiFhirBundleToCaspio(bundle, bundle.communityId, {
      unmatched: {
        companyId: bundle.companyId,
        externalResidentId: bundle.demographics.externalResidentId,
        roomNumber: bundle.demographics.roomNumber,
        firstName: bundle.demographics.firstName,
        lastName: bundle.demographics.lastName,
        dateOfBirth: bundle.demographics.dateOfBirth,
        eventType: bundle.event.eventType,
        eventMessageId: bundle.event.eventMessageId,
      },
    });
    return;
  }

  if (input.source === 'yardi-hl7') {
    await handleYardiHl7Event(input);
    return;
  }

  throw new Error(`No event orchestrator implemented for source '${input.source}'`);
}
