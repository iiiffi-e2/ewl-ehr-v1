import type { EhrLifecycleKind } from '../ehr/types.js';

export const SUPPORTED_YARDI_HL7_TRIGGERS: ReadonlySet<string> = new Set([
  'A01',
  'A02',
  'A03',
  'A05',
  'A08',
  'A21',
  'A22',
  'A60',
]);

export function normalizeYardiHl7Trigger(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

export function isSupportedYardiHl7Trigger(trigger: string): boolean {
  return SUPPORTED_YARDI_HL7_TRIGGERS.has(normalizeYardiHl7Trigger(trigger));
}

export function triggerFromYardiHl7EventType(eventType: string): string {
  const normalized = eventType.trim().toLowerCase();
  const prefix = 'hl7.adt.';
  if (normalized.startsWith(prefix)) {
    return normalizeYardiHl7Trigger(normalized.slice(prefix.length));
  }
  return normalizeYardiHl7Trigger(eventType);
}

export function isSupportedYardiHl7EventType(eventType: string): boolean {
  return isSupportedYardiHl7Trigger(triggerFromYardiHl7EventType(eventType));
}

export function lifecycleFromYardiHl7Trigger(trigger: string): EhrLifecycleKind {
  const normalized = normalizeYardiHl7Trigger(trigger);
  if (normalized === 'A05') return 'created';
  if (normalized === 'A01') return 'move_in';
  if (normalized === 'A03') return 'move_out';
  if (normalized === 'A21') return 'leave_start';
  if (normalized === 'A22') return 'leave_end';
  if (normalized === 'A08' || normalized === 'A02' || normalized === 'A60') return 'update';
  return 'unknown';
}

export function lifecycleFromYardiHl7EventType(eventType: string): EhrLifecycleKind {
  return lifecycleFromYardiHl7Trigger(triggerFromYardiHl7EventType(eventType));
}
