import { describe, expect, it, vi } from 'vitest';
import {
  createOfficialRegistryConfig,
  normalizeOfficialRegistryCandidates,
  queryOfficialRegistry
} from './officialRegistry.ts';

describe('official registry adapter', () => {
  it('normalizes common official registry response shapes', () => {
    const candidates = normalizeOfficialRegistryCandidates({
      data: {
        records: [
          {
            enterpriseName: '杭州星澜医疗美容诊所',
            unifiedSocialCreditCode: '91330100MA2B123456',
            regStatus: '存续',
            legalPerson: '张三',
            address: '杭州市示例路 1 号',
            businessScope: '医疗美容服务'
          }
        ]
      }
    }, 'official_registry');

    expect(candidates).toEqual([
      {
        name: '杭州星澜医疗美容诊所',
        creditCode: '91330100MA2B123456',
        registrationStatus: '存续',
        legalRepresentative: '张三',
        registeredAddress: '杭州市示例路 1 号',
        businessScope: '医疗美容服务',
        source: 'official_registry',
        sourceUrl: ''
      }
    ]);
  });

  it('returns unconfigured status when endpoint is missing', async () => {
    const result = await queryOfficialRegistry({
      config: createOfficialRegistryConfig({}),
      institutionName: '杭州星澜医疗美容诊所',
      clientInstanceId: 'client-1'
    });

    expect(result).toMatchObject({
      status: 'unconfigured',
      candidates: []
    });
  });

  it('posts a server-side lookup request and maps candidates', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        records: [
          {
            name: '杭州星澜医疗美容诊所',
            creditCode: '91330100MA2B123456'
          }
        ]
      })
    }));

    const result = await queryOfficialRegistry({
      config: createOfficialRegistryConfig({
        endpoint: 'https://registry.example.com/search',
        apiKey: 'secret',
        provider: 'authorized_registry'
      }),
      institutionName: '杭州星澜医疗美容诊所',
      clientInstanceId: 'client-1',
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://registry.example.com/search', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer secret'
      })
    }));
    expect(result.status).toBe('completed');
    expect(result.candidates[0].creditCode).toBe('91330100MA2B123456');
  });
});
