import type { RequestHandler } from 'express';
import express from 'express';

const textParser = express.text({
  type: [
    'text/plain',
    'application/hl7-v2',
    'application/hl7-v2+er7',
    'x-application/hl7-v2+er7',
  ],
  limit: '1mb',
});

/**
 * Ensures raw HL7 posts are available as a string on req.body.
 * JSON posts are left to the global express.json() parser.
 */
export const parseYardiHl7Body: RequestHandler = (req, res, next) => {
  const contentType = req.headers['content-type'] ?? '';
  const isJson = contentType.includes('application/json');
  if (isJson) {
    next();
    return;
  }
  textParser(req, res, (err) => {
    if (err) {
      next(err);
      return;
    }
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      req.body = String(req.body);
    }
    next();
  });
};
