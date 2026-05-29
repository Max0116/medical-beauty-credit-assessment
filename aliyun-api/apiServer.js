import { createProxyServer, parseAllowedOrigins } from './proxyServer.js';
import { createAliyunApiServer } from './aliyunHandler.js';
import { createOssClientFromEnv, createOssEvidenceStorage } from './ossStorage.js';
import { createPostgresPoolFromEnv, createRdsAssessmentRepository } from './rdsRepository.js';
import { createDualWriteAssessmentRepository, createUpstreamAssessmentRepository } from './upstreamRepository.js';
import { createZhipuVerificationService } from './zhipuVerificationService.js';

export const BACKEND_MODES = {
  proxy: 'proxy',
  aliyun: 'aliyun',
  dualWrite: 'dual_write'
};

export function resolveBackendMode(value = '') {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === BACKEND_MODES.aliyun) return BACKEND_MODES.aliyun;
  if (mode === BACKEND_MODES.dualWrite) return BACKEND_MODES.dualWrite;
  return BACKEND_MODES.proxy;
}

export function createAssessmentApiServer({ env = process.env } = {}) {
  const mode = resolveBackendMode(env.MEDICAL_CREDIT_BACKEND_MODE);
  if (mode === BACKEND_MODES.proxy) {
    return createProxyServer({
      upstreamUrl: env.ASSESSMENT_UPSTREAM_URL || '',
      upstreamApiKey: env.ASSESSMENT_UPSTREAM_API_KEY || '',
      allowedOrigins: parseAllowedOrigins(env.MEDICAL_CREDIT_ALLOWED_ORIGINS || ''),
      timeoutMs: Number(env.MEDICAL_CREDIT_PROXY_TIMEOUT_MS || 15000)
    });
  }

  const pool = createPostgresPoolFromEnv(env);
  if (!pool) throw new Error('ALIYUN_RDS_HOST is required when MEDICAL_CREDIT_BACKEND_MODE=aliyun or dual_write.');
  const ossClient = createOssClientFromEnv(env);
  const evidenceStorage = ossClient
    ? createOssEvidenceStorage({
      client: ossClient,
      bucket: env.ALIYUN_OSS_BUCKET,
      signedUrlTtlSeconds: Number(env.ALIYUN_OSS_SIGNED_URL_TTL_SECONDS || 1800)
    })
    : null;
  const rdsRepository = createRdsAssessmentRepository({
    pool,
    signEvidenceAttachments: evidenceStorage?.signEvidenceAttachments
  });
  const secondaryRepository = mode === BACKEND_MODES.dualWrite
    ? createUpstreamAssessmentRepository({
      upstreamUrl: env.ASSESSMENT_UPSTREAM_URL || '',
      upstreamApiKey: env.ASSESSMENT_UPSTREAM_API_KEY || '',
      timeoutMs: Number(env.MEDICAL_CREDIT_PROXY_TIMEOUT_MS || 15000)
    })
    : null;
  const repository = mode === BACKEND_MODES.dualWrite
    ? createDualWriteAssessmentRepository({ primary: rdsRepository, secondary: secondaryRepository })
    : rdsRepository;
  const verificationService = createZhipuVerificationService({
    apiKey: env.ZHIPUAI_API_KEY || '',
    summaryModel: env.ZHIPUAI_SUMMARY_MODEL || 'glm-4-flash',
    searchTimeoutMs: Number(env.ZHIPUAI_SEARCH_TIMEOUT_MS || 12000),
    summaryTimeoutMs: Number(env.ZHIPUAI_SUMMARY_TIMEOUT_MS || 12000)
  });

  return createAliyunApiServer({
    repository,
    evidenceStorage,
    verificationService,
    allowedOrigins: parseAllowedOrigins(env.MEDICAL_CREDIT_ALLOWED_ORIGINS || '')
  });
}
