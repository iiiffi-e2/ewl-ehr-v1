## Insurance Normalization Testing

This document describes how to test the Medicare-first insurance normalization logic.

### Unit tests

Run the full test suite:
```
npm test
```

Run only the normalization tests:
```
npm test -- tests/integrations/caspio/insuranceNormalization.test.ts
```

Run only the Caspio mapper tests:
```
npm test -- tests/integrations/caspio/caspioMapper.test.ts
```

### What the tests cover

- Medicare is moved into slot 1 when it appears in the second position.
- Ordering is preserved when Medicare is already first.
- Ordering is preserved when no Medicare is present.
- Single Medicare insurance results in slot 1 filled and slot 2 empty.
- When more than two medical insurances exist, only the first two are selected and then ordered with Medicare first.
