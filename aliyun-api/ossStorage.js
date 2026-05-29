import OSS from 'ali-oss';
import {
  EVIDENCE_ATTACHMENT_MAX_BYTES,
  EVIDENCE_ATTACHMENT_MIME_TYPES,
  sanitizeFileName,
  sanitizeStorageSegment
} from './assessmentContract.js';

export function createOssClientFromEnv(env = process.env) {
  if (!env.ALIYUN_OSS_REGION || !env.ALIYUN_OSS_BUCKET) return null;
  return new OSS({
    region: env.ALIYUN_OSS_REGION,
    bucket: env.ALIYUN_OSS_BUCKET,
    accessKeyId: env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    stsToken: env.ALIYUN_OSS_STS_TOKEN || undefined,
    secure: env.ALIYUN_OSS_SECURE !== 'false'
  });
}

export function createOssEvidenceStorage({
  client,
  bucket,
  signedUrlTtlSeconds = 1800,
  now = () => new Date(),
  id = createId
} = {}) {
  if (!client) throw new Error('OSS storage requires an ali-oss client.');
  if (!bucket) throw new Error('OSS storage requires a bucket name.');

  const uploadEvidenceAttachment = async ({ clientInstanceId, recordId, file }) => {
    validateEvidenceFile(file);
    const attachmentId = id();
    const safeName = sanitizeFileName(file.fileName || file.name || 'evidence');
    const objectPath = [
      'verification-evidence',
      sanitizeStorageSegment(clientInstanceId),
      sanitizeStorageSegment(recordId),
      formatDate(now()),
      `${attachmentId}-${safeName}`
    ].join('/');

    await client.put(objectPath, file.buffer, {
      headers: {
        'Content-Type': file.mimeType || file.type
      }
    });

    return signEvidenceAttachment({
      id: attachmentId,
      bucket,
      path: objectPath,
      fileName: file.fileName || file.name || safeName,
      mimeType: file.mimeType || file.type,
      size: Number(file.size || file.buffer?.length || 0),
      uploadedAt: now().toISOString()
    });
  };

  const signEvidenceAttachment = async (attachment) => {
    const signedUrl = client.signatureUrl(attachment.path, {
      expires: Number(signedUrlTtlSeconds) || 1800,
      method: 'GET'
    });
    return { ...attachment, signedUrl };
  };

  const signEvidenceAttachments = async (attachments = []) => {
    return Promise.all(attachments.map(signEvidenceAttachment));
  };

  const health = async () => {
    const status = {
      ok: true,
      configured: true,
      provider: 'aliyun-oss',
      bucket,
      signedUrlTtlSeconds: Number(signedUrlTtlSeconds) || 1800
    };

    if (typeof client.getBucketInfo !== 'function') return status;

    try {
      const bucketInfo = await client.getBucketInfo(bucket);
      return {
        ...status,
        bucketReachable: true,
        region: bucketInfo?.bucket?.location || bucketInfo?.location
      };
    } catch (error) {
      return {
        ...status,
        ok: false,
        bucketReachable: false,
        errorMessage: error instanceof Error ? error.message : String(error || 'OSS bucket health check failed')
      };
    }
  };

  return {
    health,
    uploadEvidenceAttachment,
    signEvidenceAttachment,
    signEvidenceAttachments
  };
}

export function validateEvidenceFile(file) {
  if (!file) throw new Error('file is required.');
  const size = Number(file.size || file.buffer?.length || 0);
  const mimeType = String(file.mimeType || file.type || '').trim();

  if (size <= 0) throw new Error('file must not be empty.');
  if (size > EVIDENCE_ATTACHMENT_MAX_BYTES) throw new Error('file must be 10MB or smaller.');
  if (!EVIDENCE_ATTACHMENT_MIME_TYPES.has(mimeType)) throw new Error('file type is not supported.');
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
