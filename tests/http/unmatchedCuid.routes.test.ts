import request from 'supertest';

const listUnmatchedCuidsMock = jest.fn();
const resolveUnmatchedCuidMock = jest.fn();

jest.mock('../../src/domains/unmatchedCuid.js', () => {
  class UnmatchedCuidQueryError extends Error {
    statusCode = 400;
  }
  return {
    UnmatchedCuidQueryError,
    listUnmatchedCuids: (...args: unknown[]) => listUnmatchedCuidsMock(...args),
    resolveUnmatchedCuid: (...args: unknown[]) => resolveUnmatchedCuidMock(...args),
  };
});

import { UnmatchedCuidQueryError } from '../../src/domains/unmatchedCuid.js';
import { createApp } from '../../src/http/app.js';

const app = createApp();
const authHeader = `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`;

describe('unmatched CUID admin routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires admin auth', async () => {
    const response = await request(app).get('/admin/unmatched-cuids/rows');
    expect(response.status).toBe(401);
  });

  it('redirects the page route', async () => {
    const response = await request(app)
      .get('/admin/unmatched-cuids')
      .set('Authorization', authHeader);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/public/unmatched-cuids.html');
  });

  it('lists open rows', async () => {
    listUnmatchedCuidsMock.mockResolvedValueOnce([{ id: 1, status: 'open' }]);
    const response = await request(app)
      .get('/admin/unmatched-cuids/rows?communityId=113')
      .set('Authorization', authHeader);
    expect(response.status).toBe(200);
    expect(response.body.rows).toEqual([{ id: 1, status: 'open' }]);
    expect(listUnmatchedCuidsMock).toHaveBeenCalledWith({
      status: 'open',
      communityId: 113,
    });
  });

  it('returns 500 when listing rows fails unexpectedly', async () => {
    listUnmatchedCuidsMock.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await request(app)
      .get('/admin/unmatched-cuids/rows')
      .set('Authorization', authHeader);
    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('database unavailable');
  });

  it('returns 400 for an unknown status', async () => {
    listUnmatchedCuidsMock.mockRejectedValueOnce(
      new UnmatchedCuidQueryError('status must be open, resolved, or all'),
    );
    const response = await request(app)
      .get('/admin/unmatched-cuids/rows?status=nope')
      .set('Authorization', authHeader);
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('resolves a row', async () => {
    resolveUnmatchedCuidMock.mockResolvedValueOnce({ id: 4, status: 'resolved' });
    const response = await request(app)
      .post('/admin/unmatched-cuids/4/resolve')
      .set('Authorization', authHeader);
    expect(response.status).toBe(200);
    expect(response.body.row.status).toBe('resolved');
    expect(resolveUnmatchedCuidMock).toHaveBeenCalledWith(4);
  });

  it('returns 404 when the row is missing', async () => {
    resolveUnmatchedCuidMock.mockResolvedValueOnce(null);
    const response = await request(app)
      .post('/admin/unmatched-cuids/4/resolve')
      .set('Authorization', authHeader);
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Unmatched CUID row not found');
  });
});
