export const ALIYUN_RELEASE_DOC_FILES = [
  'aliyun-pr22-api-proxy.md',
  'aliyun-pr22-it-handoff.md',
  'pr22-deployment-acceptance.md',
  'pr23-aliyun-rds-oss-migration-plan.md',
  'pr23-pr24-handoff-index.md',
  'aliyun-pr23-it-handoff.md',
  'aliyun-pr23-access-unlock-request.md',
  'aliyun-pr23-server-inventory-checklist.md',
  'pr23-aliyun-node-runtime-options.md',
  'pr23-aliyun-cutover-runbook.md',
  'pr23-aliyun-public-reachability-log.md',
  'pr23-readiness-audit.md',
  'pr23-deployment-acceptance.md',
  'pr24-supabase-decommission-audit.md',
  'pr24-aliyun-production-ops-runbook.md'
];

export function buildAliyunReleaseDocIncludes(docFiles = ALIYUN_RELEASE_DOC_FILES) {
  return docFiles.map((fileName) => `docs/${fileName}`);
}
