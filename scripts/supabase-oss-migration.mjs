import { fetchSupabaseTableBatches, normalizeSupabaseUrl } from './supabase-rds-migration.mjs';

export async function migrateSupabaseEvidenceToOss({
  ossClient,
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
  sourceBucket = 'verification-evidence',
  targetBucket = '',
  batchSize = 500,
  dryRun = false,
  logger = console
} = {}) {
  if (!ossClient?.put && !dryRun) throw new Error('Evidence OSS migration requires an ali-oss client.');
  const attachments = await collectSupabaseEvidenceAttachments({
    supabaseUrl,
    serviceRoleKey,
    fetchImpl,
    sourceBucket,
    batchSize
  });
  const summary = {
    ok: true,
    dryRun,
    sourceBucket,
    targetBucket,
    discovered: attachments.length,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    failures: []
  };

  for (const attachment of attachments) {
    if (dryRun) {
      summary.skipped += 1;
      continue;
    }

    try {
      const response = await fetchImpl(buildSupabaseStorageObjectUrl(supabaseUrl, sourceBucket, attachment.path), {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      });
      if (!response.ok) {
        throw new Error(`download returned ${response.status}`);
      }
      const body = Buffer.from(await response.arrayBuffer());
      await ossClient.put(attachment.path, body, {
        headers: {
          'Content-Type': attachment.mimeType || 'application/octet-stream'
        }
      });
      summary.uploaded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown error');
      logger.warn?.(`evidence attachment migration failed: ${attachment.path}`, message);
      summary.failed += 1;
      summary.failures.push({ path: attachment.path, errorMessage: message });
    }
  }

  return summary;
}

export async function collectSupabaseEvidenceAttachments({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
  sourceBucket = 'verification-evidence',
  batchSize = 500
} = {}) {
  const byPath = new Map();

  for await (const rows of fetchSupabaseTableBatches({
    supabaseUrl,
    serviceRoleKey,
    tableName: 'verification_reviews',
    batchSize,
    fetchImpl
  })) {
    for (const row of rows) {
      for (const attachment of extractReviewEvidenceAttachments(row, sourceBucket)) {
        if (!byPath.has(attachment.path)) byPath.set(attachment.path, attachment);
      }
    }
  }

  return [...byPath.values()];
}

export function extractReviewEvidenceAttachments(row = {}, sourceBucket = 'verification-evidence') {
  const snapshot = row.verification_snapshot && typeof row.verification_snapshot === 'object' && !Array.isArray(row.verification_snapshot)
    ? row.verification_snapshot
    : {};
  return [
    ...normalizeEvidenceAttachments(row.evidence_attachments, sourceBucket),
    ...normalizeEvidenceAttachments(snapshot.evidenceAttachments, sourceBucket)
  ];
}

export function normalizeEvidenceAttachments(value, sourceBucket = 'verification-evidence') {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      id: String(item.id || '').trim(),
      bucket: String(item.bucket || '').trim(),
      path: String(item.path || '').trim(),
      fileName: String(item.fileName || '').trim(),
      mimeType: String(item.mimeType || '').trim(),
      size: Number(item.size || 0),
      uploadedAt: String(item.uploadedAt || '').trim()
    }))
    .filter((item) => item.bucket === sourceBucket && item.path && item.fileName);
}

export function buildSupabaseStorageObjectUrl(supabaseUrl, bucket, path) {
  const encodedPath = String(path || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${normalizeSupabaseUrl(supabaseUrl)}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}
