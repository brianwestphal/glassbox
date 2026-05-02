import { checkEnum } from '../../../src/utils/validate.js';

describe('checkEnum', () => {
  const sides = ['old', 'new'] as const;

  it('returns ok with the value when valid', () => {
    expect(checkEnum('old', 'side', sides)).toEqual({ ok: 'old' });
  });

  it('returns error message when value is not in the allowed list', () => {
    expect(checkEnum('left', 'side', sides)).toEqual({ error: 'side must be one of: old, new' });
  });

  it('returns error when value is not a string', () => {
    expect(checkEnum(undefined, 'side', sides)).toEqual({ error: 'side must be one of: old, new' });
    expect(checkEnum(42, 'side', sides)).toEqual({ error: 'side must be one of: old, new' });
    expect(checkEnum(null, 'side', sides)).toEqual({ error: 'side must be one of: old, new' });
  });

  it('uses the provided field name in the error', () => {
    expect(checkEnum('bad', 'category', ['bug', 'note'] as const))
      .toEqual({ error: 'category must be one of: bug, note' });
  });
});
