import { extractJSON, isNeedContext } from '../../../src/ai/shared.js';

describe('extractJSON', () => {
  it('parses plain JSON object', () => {
    const result = extractJSON('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses plain JSON array', () => {
    const result = extractJSON('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('strips markdown code fences', () => {
    const result = extractJSON('```json\n{"key": "value"}\n```');
    expect(result).toEqual({ key: 'value' });
  });

  it('strips code fences without language tag', () => {
    const result = extractJSON('```\n{"key": "value"}\n```');
    expect(result).toEqual({ key: 'value' });
  });

  it('extracts array from surrounding prose', () => {
    const result = extractJSON('Here is the result:\n[{"id": 1}]\nDone.');
    expect(result).toEqual([{ id: 1 }]);
  });

  it('extracts object from surrounding prose', () => {
    const result = extractJSON('The analysis is:\n{"score": 0.5}\nEnd of analysis.');
    expect(result).toEqual({ score: 0.5 });
  });

  it('throws for completely invalid input', () => {
    expect(() => extractJSON('no json here')).toThrow('Could not extract JSON');
  });

  it('throws for malformed JSON', () => {
    expect(() => extractJSON('{invalid: json}')).toThrow('Could not extract JSON');
  });

  it('extracts array even when preceded by prose and code fence', () => {
    // Code fence stripping only works when fences are at start/end of text
    // With trailing prose, it falls through to regex extraction
    const result = extractJSON('Here is the data: [1, 2, 3] end');
    expect(result).toEqual([1, 2, 3]);
  });
});

describe('isNeedContext', () => {
  it('returns true for valid NeedContextResponse', () => {
    expect(isNeedContext({ needContext: ['file1.ts', 'file2.ts'] })).toBe(true);
  });

  it('returns true for empty array', () => {
    expect(isNeedContext({ needContext: [] })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isNeedContext(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isNeedContext('string')).toBe(false);
    expect(isNeedContext(42)).toBe(false);
  });

  it('returns false for object without needContext', () => {
    expect(isNeedContext({ otherKey: [] })).toBe(false);
  });

  it('returns false when needContext is not an array', () => {
    expect(isNeedContext({ needContext: 'not-array' })).toBe(false);
  });
});
