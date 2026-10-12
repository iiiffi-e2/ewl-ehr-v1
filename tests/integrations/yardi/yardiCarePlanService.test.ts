import * as caspioClient from '../../../src/integrations/caspio/caspioClient.js';
import * as communityEnrichment from '../../../src/integrations/caspio/caspioCommunityEnrichment.js';
import {
  applyEyeWatchServiceChange,
  eyeWatchServiceTypeFromLabel,
  readEyeWatchFromCarePlanBundles,
  runYardiCarePlanServiceCheck,
} from '../../../src/integrations/yardi/yardiCarePlanService.js';
import type { FhirBundle, YardiFhirPatientBundle } from '../../../src/integrations/yardi/yardiFhirTypes.js';
import type { ServiceTableRecord } from '../../../src/integrations/caspio/caspioClient.js';

function carePlanBundle(
  activities: Array<Record<string, unknown>>,
  status = 'active',
): FhirBundle {
  return {
    entry: [
      {
        resource: {
          resourceType: 'CarePlan',
          status,
          activity: activities,
        },
      },
    ],
  };
}

function eyeWatchActivity(code: string, reason = 'EyeWatch Monitoring'): Record<string, unknown> {
  return {
    detail: {
      code: { text: code },
      reasonCode: [{ text: reason }],
    },
  };
}

describe('readEyeWatchFromCarePlanBundles', () => {
  it('reads Detect from an EyeWatch Monitoring activity', () => {
    const reading = readEyeWatchFromCarePlanBundles([
      carePlanBundle([eyeWatchActivity('EyeWatch - Detect'), eyeWatchActivity('Humidifier', '01. Diagnoses')]),
    ]);

    expect(reading).toEqual({ serviceType: 'Detect', monitoringWithoutLevel: false });
  });

  it('prefers Intervene when both EyeWatch activities are on the active plan', () => {
    const reading = readEyeWatchFromCarePlanBundles([
      carePlanBundle([
        eyeWatchActivity('EyeWatch - Detect'),
        eyeWatchActivity('EyeWatch - Intervene'),
      ]),
    ]);

    expect(reading.serviceType).toBe('Intervene');
  });

  it('ignores completed plans and non-EyeWatch activities', () => {
    const reading = readEyeWatchFromCarePlanBundles([
      carePlanBundle([eyeWatchActivity('EyeWatch - Detect')], 'completed'),
      carePlanBundle([eyeWatchActivity('Level of Assistance-Bathing: Minimal', '09. Bathing')]),
    ]);

    expect(reading).toEqual({ serviceType: null, monitoringWithoutLevel: false });
  });

  it('does not choose a level when EyeWatch Monitoring is present without Detect or Intervene', () => {
    const reading = readEyeWatchFromCarePlanBundles([
      carePlanBundle([eyeWatchActivity('Pendant call system', 'EyeWatch Monitoring')]),
    ]);

    expect(reading).toEqual({ serviceType: null, monitoringWithoutLevel: true });
  });
});

describe('eyeWatchServiceTypeFromLabel', () => {
  it('matches existing Detect and Intervene service rows', () => {
    expect(eyeWatchServiceTypeFromLabel('Detect')).toBe('Detect');
    expect(eyeWatchServiceTypeFromLabel('Intervene 12')).toBe('Intervene');
    expect(eyeWatchServiceTypeFromLabel('Unassigned')).toBeNull();
  });
});

describe('applyEyeWatchServiceChange', () => {
  const boundaryDate = '10/12/2026 22:00:00';

  function row(id: string, serviceType: string, endDate?: string): { id: string; record: ServiceTableRecord } {
    return { id, record: { ServiceType: serviceType, EndDate: endDate, StartDate: '01/01/2026 00:00:00' } };
  }

  it('opens Detect when the resident has no EyeWatch service row', async () => {
    const closed: string[] = [];
    const opened: string[] = [];

    const action = await applyEyeWatchServiceChange({
      reading: { serviceType: 'Detect', monitoringWithoutLevel: false },
      rows: [row('1', 'Unassigned')],
      boundaryDate,
      closeRow: async (id) => {
        closed.push(id);
      },
      openRow: async (serviceType) => {
        opened.push(serviceType);
      },
    });

    expect(action).toBe('open');
    expect(closed).toEqual([]);
    expect(opened).toEqual(['Detect']);
  });

  it('does nothing when the open service already matches', async () => {
    const closed: string[] = [];
    const opened: string[] = [];

    const action = await applyEyeWatchServiceChange({
      reading: { serviceType: 'Detect', monitoringWithoutLevel: false },
      rows: [row('1', 'Detect')],
      boundaryDate,
      closeRow: async (id) => {
        closed.push(id);
      },
      openRow: async (serviceType) => {
        opened.push(serviceType);
      },
    });

    expect(action).toBe('none');
    expect(closed).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('closes Detect and opens Intervene when the care plan level changes', async () => {
    const closed: Array<{ id: string; endDate: string }> = [];
    const opened: string[] = [];

    const action = await applyEyeWatchServiceChange({
      reading: { serviceType: 'Intervene', monitoringWithoutLevel: false },
      rows: [row('9', 'Detect')],
      boundaryDate,
      closeRow: async (id, endDate) => {
        closed.push({ id, endDate });
      },
      openRow: async (serviceType) => {
        opened.push(serviceType);
      },
    });

    expect(action).toBe('replace');
    expect(closed).toEqual([{ id: '9', endDate: boundaryDate }]);
    expect(opened).toEqual(['Intervene']);
  });

  it('ends an open EyeWatch row when the care plan no longer has EyeWatch Monitoring', async () => {
    const closed: string[] = [];
    const opened: string[] = [];

    const action = await applyEyeWatchServiceChange({
      reading: { serviceType: null, monitoringWithoutLevel: false },
      rows: [row('4', 'Intervene'), row('5', 'Detect', '04/01/2026 00:00:00')],
      boundaryDate,
      closeRow: async (id) => {
        closed.push(id);
      },
      openRow: async (serviceType) => {
        opened.push(serviceType);
      },
    });

    expect(action).toBe('close');
    expect(closed).toEqual(['4']);
    expect(opened).toEqual([]);
  });

  it('does nothing when there is no EyeWatch monitoring and no EyeWatch service row', async () => {
    const action = await applyEyeWatchServiceChange({
      reading: { serviceType: null, monitoringWithoutLevel: false },
      rows: [row('1', 'Unassigned')],
      boundaryDate,
      closeRow: async () => {
        throw new Error('should not close');
      },
      openRow: async () => {
        throw new Error('should not open');
      },
    });

    expect(action).toBe('none');
  });

  it('does not end a service row when EyeWatch Monitoring has no Detect or Intervene level', async () => {
    const action = await applyEyeWatchServiceChange({
      reading: { serviceType: null, monitoringWithoutLevel: true },
      rows: [row('4', 'Detect')],
      boundaryDate,
      closeRow: async () => {
        throw new Error('should not close');
      },
      openRow: async () => {
        throw new Error('should not open');
      },
    });

    expect(action).toBe('none');
  });
});

describe('runYardiCarePlanServiceCheck', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes a Detect service row for the requested patient', async () => {
    jest.spyOn(communityEnrichment, 'getCommunityEnrichment').mockResolvedValue({
      CUID: '259',
      CommunityName: 'EyeWatch Live',
    });
    jest.spyOn(caspioClient, 'listServiceRowsForPatient').mockResolvedValue([]);
    const upsert = jest.spyOn(caspioClient, 'upsertByFields').mockResolvedValue({ action: 'insert' });
    jest.spyOn(caspioClient, 'updateRecordById').mockResolvedValue({} as never);

    const bundle: YardiFhirPatientBundle = {
      patientId: '31924-2',
      patient: { name: [{ given: ['Jarmaine'], family: 'Go' }] },
      encounterBundle: {
        entry: [
          {
            resource: {
              resourceType: 'Encounter',
              location: [{ location: { display: '101' } }],
            },
          },
        ],
      },
      coverageBundle: {},
      conditionBundle: {},
    };

    const summary = await runYardiCarePlanServiceCheck({
      communityId: 237,
      organizationId: '237-1',
      patientId: '31924-2',
      client: {
        listActivePatientIds: async () => {
          throw new Error('should not list the organization when a patient id is set');
        },
        fetchPatientBundle: async () => bundle,
        listActiveCarePlans: async () => [carePlanBundle([eyeWatchActivity('EyeWatch - Detect')])],
      },
    });

    expect(summary.patients).toEqual([
      expect.objectContaining({
        patientId: '31924-2',
        firstName: 'Jarmaine',
        lastName: 'Go',
        roomNumber: '101',
        cuid: '259',
        serviceType: 'Detect',
        action: 'open',
      }),
    ]);
    expect(summary.opened).toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([{ field: 'ServiceType', value: 'Detect' }]),
      expect.objectContaining({ ServiceType: 'Detect', PatientNumber: '31924-2', RoomNumber: '101' }),
    );
  });
});
