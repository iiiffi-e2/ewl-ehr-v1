import { z } from 'zod';

export const AlisEventSchema = z.object({
  CompanyKey: z.string(),
  CommunityId: z.number().nullable().optional(),
  EventType: z.string(),
  EventMessageId: z.union([z.string(), z.number()]).transform(String),
  EventMessageDate: z.string(),
  NotificationData: z.record(z.any()).optional(),
});

export type AlisEvent = z.infer<typeof AlisEventSchema>;

export const RESIDENT_EVENT_TYPES = new Set([
  'residents.move_in',
  'residents.move_out',
  'residents.leave_start',
  'residents.leave_end',
  'residents.leave_cancelled',
  'residents.basic_info_updated',
]);

export const LEAVE_EVENT_TYPES = new Set([
  'residents.leave_start',
  'residents.leave_end',
  'residents.leave_cancelled',
]);

export function isSupportedEventType(eventType: string): boolean {
  return RESIDENT_EVENT_TYPES.has(eventType) || eventType === 'test.event';
}

export function requiresResidentFetch(eventType: string): boolean {
  return RESIDENT_EVENT_TYPES.has(eventType);
}

export function requiresLeaveFetch(eventType: string): boolean {
  return LEAVE_EVENT_TYPES.has(eventType);
}
