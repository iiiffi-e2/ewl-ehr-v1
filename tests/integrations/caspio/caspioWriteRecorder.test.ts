jest.mock('../../../src/config/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  runWithCaspioWriteRecorder,
} from '../../../src/integrations/caspio/caspioWriteRecorder.js';
import { noteCaspioWrite } from '../../../src/integrations/caspio/caspioWriteRecorder.js';

describe('caspioWriteRecorder', () => {
  it('blocks writes in dry-run and records the operation', async () => {
    const { operations } = await runWithCaspioWriteRecorder({ dryRun: true }, async () => {
      expect(
        noteCaspioWrite({
          table: 'CarePatientTable_API',
          action: 'upsert',
          fields: [{ field: 'PatientNumber', value: '1' }],
          record: { First_Name: 'Test' },
        }),
      ).toBe('block');
    });
    expect(operations).toEqual([
      {
        table: 'CarePatientTable_API',
        action: 'upsert',
        fields: [{ field: 'PatientNumber', value: '1' }],
        record: { First_Name: 'Test' },
      },
    ]);
  });

  it('passes through and still records in live mode', async () => {
    const { operations } = await runWithCaspioWriteRecorder({ dryRun: false }, async () => {
      expect(
        noteCaspioWrite({
          table: 'CarePatientTable_API',
          action: 'update',
          id: '9',
          record: { RoomNumber: '141' },
        }),
      ).toBe('passthrough');
    });
    expect(operations).toHaveLength(1);
    expect(operations[0]?.action).toBe('update');
  });

  it('passes through when no recorder is active', () => {
    expect(
      noteCaspioWrite({
        table: 'CarePatientTable_API',
        action: 'upsert',
        record: {},
      }),
    ).toBe('passthrough');
  });
});
