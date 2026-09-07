const postMock = jest.fn();
const getMock = jest.fn();
const putMock = jest.fn();

jest.mock('../../../src/config/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../src/config/axios.js', () => ({
  createHttpClient: jest.fn(() => ({
    post: (...args: unknown[]) => postMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    request: jest.fn(),
  })),
}));

import {
  runWithCaspioWriteRecorder,
} from '../../../src/integrations/caspio/caspioWriteRecorder.js';
import { noteCaspioWrite } from '../../../src/integrations/caspio/caspioWriteRecorder.js';
import { insertRecord, upsertByFields } from '../../../src/integrations/caspio/caspioClient.js';

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

  it('attaches recorded operations when the callback throws', async () => {
    const boom = new Error('boom');
    await expect(
      runWithCaspioWriteRecorder({ dryRun: true }, async () => {
        noteCaspioWrite({
          table: 'CarePatientTable_API',
          action: 'upsert',
          record: { PatientNumber: '1' },
        });
        throw boom;
      }),
    ).rejects.toMatchObject({
      message: 'boom',
      caspioOperations: [
        {
          table: 'CarePatientTable_API',
          action: 'upsert',
          record: { PatientNumber: '1' },
        },
      ],
    });
  });

  it('blocks insertRecord HTTP under a dry-run recorder', async () => {
    postMock.mockReset();
    getMock.mockReset();
    putMock.mockReset();

    const { result, operations } = await runWithCaspioWriteRecorder({ dryRun: true }, async () => {
      return insertRecord('CarePatientTable_API', { First_Name: 'Test' });
    });

    expect(postMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(result.statusText).toBe('DRY_RUN');
    expect(result.data).toEqual({ dryRun: true });
    expect(operations).toEqual([
      {
        table: 'CarePatientTable_API',
        action: 'upsert',
        record: { First_Name: 'Test' },
      },
    ]);
  });

  it('blocks upsertByFields HTTP under a dry-run recorder', async () => {
    postMock.mockReset();
    getMock.mockReset();
    putMock.mockReset();

    const { result, operations } = await runWithCaspioWriteRecorder({ dryRun: true }, async () => {
      return upsertByFields(
        'CarePatientTable_API',
        [{ field: 'PatientNumber', value: '1' }],
        { First_Name: 'Test' },
      );
    });

    expect(postMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(result).toEqual({ action: 'insert', id: 'dry-run' });
    expect(operations[0]?.action).toBe('upsert');
  });
});
