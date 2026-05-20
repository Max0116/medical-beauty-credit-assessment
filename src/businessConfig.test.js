import { describe, expect, it } from 'vitest';
import { DEFAULT_DEEP_VERIFICATION_HIGH_LIMIT, getBusinessConfig, parseMoneyConfig } from './businessConfig';

describe('business config', () => {
  it('uses the default deep verification threshold when env is empty', () => {
    expect(getBusinessConfig({}).deepVerificationHighLimit).toBe(DEFAULT_DEEP_VERIFICATION_HIGH_LIMIT);
  });

  it('parses configured money thresholds with common formatting', () => {
    expect(parseMoneyConfig('80000')).toBe(80000);
    expect(parseMoneyConfig('¥120,000')).toBe(120000);
  });

  it('falls back when the configured threshold is invalid', () => {
    expect(parseMoneyConfig('not-a-number')).toBe(DEFAULT_DEEP_VERIFICATION_HIGH_LIMIT);
    expect(parseMoneyConfig('0')).toBe(DEFAULT_DEEP_VERIFICATION_HIGH_LIMIT);
  });
});
