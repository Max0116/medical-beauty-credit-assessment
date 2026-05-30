import { describe, expect, it, vi } from 'vitest';
import {
  buildSupabaseStorageObjectUrl,
  collectSupabaseEvidenceAttachments,
  migrateSupabaseEvidenceToOss
} from './supabase-oss-migration.mjs';

describe('Supabase Storage to Aliyun OSS migration helpers', () => {
  it('collects unique evidence attachments from verification reviews', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/rest/v1/verification_reviews')) {
        return createTextResponse([
          {
            id: 'review-1',
            evidence_attachments: [
              {
                id: 'attachment-1',
                bucket: 'verification-evidence',
                path: 'client-1/record-1/截图 1.png',
                fileName: '截图 1.png',
                mimeType: 'image/png'
              }
            ],
            verification_snapshot: {
              evidenceAttachments: [
                {
                  id: 'attachment-1-duplicate',
                  bucket: 'verification-evidence',
                  path: 'client-1/record-1/截图 1.png',
                  fileName: '截图 1.png',
                  mimeType: 'image/png'
                },
                {
                  id: 'wrong-bucket',
                  bucket: 'other',
                  path: 'client-1/record-1/other.png',
                  fileName: 'other.png'
                }
              ]
            }
          }
        ]);
      }
      return createTextResponse([]);
    });

    const attachments = await collectSupabaseEvidenceAttachments({
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'service-role-secret',
      fetchImpl
    });

    expect(attachments).toEqual([
      expect.objectContaining({
        id: 'attachment-1',
        path: 'client-1/record-1/截图 1.png',
        fileName: '截图 1.png'
      })
    ]);
  });

  it('downloads Supabase private objects and uploads them to OSS with the same path', async () => {
    const ossClient = {
      puts: [],
      put: vi.fn(async (path, body, options) => {
        ossClient.puts.push({ path, body: body.toString('utf8'), options });
        return { name: path };
      })
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/rest/v1/verification_reviews')) {
        return createTextResponse([
          {
            id: 'review-1',
            evidence_attachments: [
              {
                id: 'attachment-1',
                bucket: 'verification-evidence',
                path: 'client-1/record-1/file.png',
                fileName: 'file.png',
                mimeType: 'image/png'
              }
            ]
          }
        ]);
      }
      if (url.includes('/storage/v1/object/verification-evidence/client-1/record-1/file.png')) {
        return createBinaryResponse('image-bytes');
      }
      throw new Error(`unexpected url ${url}`);
    });

    const summary = await migrateSupabaseEvidenceToOss({
      ossClient,
      supabaseUrl: 'https://demo.supabase.co',
      serviceRoleKey: 'service-role-secret',
      fetchImpl,
      targetBucket: 'medical-credit-verification-evidence'
    });

    expect(summary).toMatchObject({
      ok: true,
      discovered: 1,
      uploaded: 1,
      failed: 0
    });
    expect(ossClient.puts[0]).toMatchObject({
      path: 'client-1/record-1/file.png',
      body: 'image-bytes',
      options: {
        headers: {
          'Content-Type': 'image/png'
        }
      }
    });
  });

  it('builds encoded Supabase Storage object URLs', () => {
    expect(buildSupabaseStorageObjectUrl(
      'https://demo.supabase.co/',
      'verification-evidence',
      'client-1/record-1/截图 1.png'
    )).toBe('https://demo.supabase.co/storage/v1/object/verification-evidence/client-1/record-1/%E6%88%AA%E5%9B%BE%201.png');
  });
});

function createTextResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function createBinaryResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => Buffer.from(body)
  };
}
