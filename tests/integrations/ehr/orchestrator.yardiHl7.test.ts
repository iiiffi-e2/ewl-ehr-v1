const handleYardiHl7EventMock = jest.fn();
const handleAlisEventMock = jest.fn();
const pushYardiFhirBundleToCaspioMock = jest.fn();

jest.mock('../../../src/integrations/caspio/yardiHl7EventOrchestrator.js', () => ({
  handleYardiHl7Event: handleYardiHl7EventMock,
}));

jest.mock('../../../src/integrations/caspio/eventOrchestrator.js', () => ({
  handleAlisEvent: handleAlisEventMock,
}));

jest.mock('../../../src/integrations/yardi/yardiFhirSync.js', () => ({
  pushYardiFhirBundleToCaspio: pushYardiFhirBundleToCaspioMock,
}));

import type { CanonicalEventOrchestrationInput } from '../../../src/integrations/ehr/types.js';
import { handleEhrEvent } from '../../../src/integrations/ehr/orchestrator.js';

describe('handleEhrEvent yardi-hl7 routing', () => {
  it('dispatches yardi-hl7 to its orchestrator without calling ALIS', async () => {
    const event = {
      source: 'yardi-hl7' as const,
      companyKey: 'yardi-company',
      communityId: 113,
      eventType: 'hl7.adt.a01',
      eventMessageId: 'yardi-hl7-event-1',
      eventMessageDate: '2026-08-20T14:15:16Z',
      lifecycleKind: 'move_in' as const,
      notificationData: { TriggerEvent: 'A01', ResidentId: 418612, RoomNumber: '141' },
      raw: {},
    };
    const input: CanonicalEventOrchestrationInput = {
      source: 'yardi-hl7',
      companyId: 10,
      companyKey: 'yardi-company',
      event,
      residentBundle: {
        source: 'yardi-hl7',
        companyId: 10,
        companyKey: 'yardi-company',
        communityId: 113,
        residentId: 418612,
        event,
        demographics: {
          externalResidentId: '418612',
          roomNumber: '141',
        },
      },
    };

    await handleEhrEvent(input);

    expect(handleYardiHl7EventMock).toHaveBeenCalledWith(input);
    expect(handleAlisEventMock).not.toHaveBeenCalled();
  });
});
