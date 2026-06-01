import { describe, expect, it } from 'vitest';

import {
  DifftoolStatusRespSchema,
  RegisterDifftoolReqSchema,
  RegisterDifftoolRespSchema,
  UnregisterDifftoolRespSchema,
} from '../../../src/api/difftool.js';

// GB-852 — `RegisterDifftoolRespSchema` originally used
// `z.discriminatedUnion('ok', […])` with two `ok: false` branches; zod v4
// fails parsing with "Duplicate discriminator value 'false'" because the
// discriminator can't disambiguate them. The unit tests for the helper in
// `src/git/difftool.ts` never exercised the schema, so the regression
// shipped. These tests force every variant of every wire schema through
// `.parse()` so a similar mistake fails CI, not the user's app.

describe('RegisterDifftoolRespSchema', () => {
  it('accepts the success variant', () => {
    expect(RegisterDifftoolRespSchema.parse({ ok: true, replacedTool: null })).toEqual({
      ok: true, replacedTool: null,
    });
    expect(RegisterDifftoolRespSchema.parse({ ok: true, replacedTool: 'vimdiff' })).toEqual({
      ok: true, replacedTool: 'vimdiff',
    });
  });

  it('accepts the conflict variant', () => {
    const r = RegisterDifftoolRespSchema.parse({ ok: false, reason: 'conflict', currentTool: 'Kaleidoscope' });
    expect(r).toEqual({ ok: false, reason: 'conflict', currentTool: 'Kaleidoscope' });
  });

  it('accepts the git-failed variant', () => {
    const r = RegisterDifftoolRespSchema.parse({ ok: false, reason: 'git-failed', message: '`git config` failed: ...' });
    expect(r).toEqual({ ok: false, reason: 'git-failed', message: '`git config` failed: ...' });
  });

  it('rejects an unknown reason', () => {
    expect(() => RegisterDifftoolRespSchema.parse({ ok: false, reason: 'unknown', message: 'x' })).toThrow();
  });

  it('rejects a missing replacedTool on success', () => {
    expect(() => RegisterDifftoolRespSchema.parse({ ok: true })).toThrow();
  });
});

describe('RegisterDifftoolReqSchema', () => {
  it('accepts an empty body', () => {
    expect(RegisterDifftoolReqSchema.parse({})).toEqual({});
  });
  it('accepts { force: true }', () => {
    expect(RegisterDifftoolReqSchema.parse({ force: true })).toEqual({ force: true });
  });
});

describe('DifftoolStatusRespSchema', () => {
  it('accepts the unset case', () => {
    expect(DifftoolStatusRespSchema.parse({ tool: null, cmd: null, isGlassbox: false })).toEqual({
      tool: null, cmd: null, isGlassbox: false,
    });
  });
  it('accepts a third-party tool', () => {
    expect(DifftoolStatusRespSchema.parse({ tool: 'Kaleidoscope', cmd: 'ksdiff ...', isGlassbox: false })).toEqual({
      tool: 'Kaleidoscope', cmd: 'ksdiff ...', isGlassbox: false,
    });
  });
});

describe('UnregisterDifftoolRespSchema', () => {
  it('accepts the removed case', () => {
    expect(UnregisterDifftoolRespSchema.parse({ ok: true, removed: true })).toEqual({ ok: true, removed: true });
  });
  it('accepts the no-op case', () => {
    expect(UnregisterDifftoolRespSchema.parse({ ok: true, removed: false })).toEqual({ ok: true, removed: false });
  });
});
