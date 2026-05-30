import { describe, expect, it } from 'vitest';
import { createOssEvidenceStorage, validateEvidenceFile } from './ossStorage.js';

describe('OSS evidence storage', () => {
  it('uploads evidence files into scoped private object paths and returns signed URLs', async () => {
    const calls = [];
    const client = {
      put: async (path, buffer, options) => {
        calls.push({ path, buffer, options });
        return { name: path };
      },
      signatureUrl: (path, options) => `https://oss.example.com/${path}?expires=${options.expires}`
    };
    const storage = createOssEvidenceStorage({
      client,
      bucket: 'medical-credit-verification-evidence',
      signedUrlTtlSeconds: 600,
      now: () => new Date('2026-05-30T08:00:00.000Z'),
      id: () => 'attachment-1'
    });

    const attachment = await storage.uploadEvidenceAttachment({
      clientInstanceId: 'client-1',
      recordId: 'record-1',
      file: {
        fileName: '处罚 截图.png',
        mimeType: 'image/png',
        size: 4,
        buffer: Buffer.from('demo')
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('verification-evidence/client-1/record-1/20260530/attachment-1-处罚_截图.png');
    expect(calls[0].options.headers['Content-Type']).toBe('image/png');
    expect(attachment).toMatchObject({
      id: 'attachment-1',
      bucket: 'medical-credit-verification-evidence',
      path: 'verification-evidence/client-1/record-1/20260530/attachment-1-处罚_截图.png',
      fileName: '处罚 截图.png',
      mimeType: 'image/png',
      size: 4,
      signedUrl: 'https://oss.example.com/verification-evidence/client-1/record-1/20260530/attachment-1-处罚_截图.png?expires=600'
    });
  });

  it('reports OSS readiness without exposing credentials', async () => {
    const client = {
      getBucketInfo: async (bucket) => ({
        bucket: {
          name: bucket,
          location: 'oss-cn-shanghai'
        }
      }),
      signatureUrl: (path) => `https://oss.example.com/${path}`
    };
    const storage = createOssEvidenceStorage({
      client,
      bucket: 'medical-credit-verification-evidence',
      signedUrlTtlSeconds: 900
    });

    await expect(storage.health()).resolves.toMatchObject({
      ok: true,
      configured: true,
      provider: 'aliyun-oss',
      bucket: 'medical-credit-verification-evidence',
      signedUrlTtlSeconds: 900,
      bucketReachable: true,
      region: 'oss-cn-shanghai'
    });
  });

  it('rejects unsupported evidence files before upload', () => {
    expect(() => validateEvidenceFile({ mimeType: 'text/plain', size: 10, buffer: Buffer.from('demo') })).toThrow('file type is not supported.');
    expect(() => validateEvidenceFile({ mimeType: 'image/png', size: 0, buffer: Buffer.alloc(0) })).toThrow('file must not be empty.');
    expect(() => validateEvidenceFile({ mimeType: 'image/png', size: 10 * 1024 * 1024 + 1, buffer: Buffer.alloc(1) })).toThrow('file must be 10MB or smaller.');
  });
});
