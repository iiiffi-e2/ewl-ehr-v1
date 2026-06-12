/**
 * Canonical Caspio ServiceType values for orchestrated service-line rows.
 * Keep imports here so call sites do not scatter magic strings.
 */
export const ROOM_VACANCY_SERVICE_TYPE = 'Vacant';

/** Service line ServiceType when ALIS has no Classification (never use ALIS ServiceType / ProductType here). */
export const SERVICE_LINE_UNASSIGNED_CLASSIFICATION = 'Unassigned';

/**
 * Resident service line after permanent move-out from the community.
 * Uses the same Caspio label as room vacancy (historically misspelled as "Vacay" in code).
 */
export const POST_MOVE_OUT_RESIDENT_SERVICE_TYPE = ROOM_VACANCY_SERVICE_TYPE;

/**
 * CarePatientTable RoomNumber sentinel for a resident who has been unassigned from
 * their room but remains in the community (no move-out). Distinct in meaning from the
 * `SERVICE_LINE_UNASSIGNED_CLASSIFICATION` ServiceType even though the string matches.
 */
export const UNASSIGNED_ROOM_LABEL = 'Unassigned';
