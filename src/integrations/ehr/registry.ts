import { AlisAdapter } from './alisAdapter.js';
import { YardiFhirAdapter } from './yardiFhirAdapter.js';
import { YardiHl7AdtAdapter } from './yardiHl7AdtAdapter.js';
import type { EhrAdapter } from './adapter.js';
import type { EhrSource } from './types.js';

const adapters: Record<EhrSource, EhrAdapter> = {
  alis: new AlisAdapter(),
  'yardi-fhir': new YardiFhirAdapter(),
  'yardi-hl7': new YardiHl7AdtAdapter(),
};

export function resolveEhrAdapter(source: EhrSource): EhrAdapter {
  return adapters[source];
}
