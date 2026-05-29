import { describe, expect, it } from 'vitest';
import {
  ALIYUN_RELEASE_DOC_FILES,
  buildAliyunReleaseDocIncludes
} from './aliyun-release-manifest.mjs';

describe('Aliyun release manifest helpers', () => {
  it('keeps PR23 handoff and readiness documents in the release package', () => {
    expect(ALIYUN_RELEASE_DOC_FILES).toEqual(expect.arrayContaining([
      'aliyun-pr23-it-handoff.md',
      'aliyun-pr23-access-unlock-request.md',
      'pr23-readiness-audit.md',
      'pr23-deployment-acceptance.md'
    ]));
    expect(new Set(ALIYUN_RELEASE_DOC_FILES).size).toBe(ALIYUN_RELEASE_DOC_FILES.length);
  });

  it('maps release document names to MANIFEST include paths', () => {
    expect(buildAliyunReleaseDocIncludes()).toEqual(expect.arrayContaining([
      'docs/aliyun-pr23-access-unlock-request.md',
      'docs/pr23-readiness-audit.md'
    ]));
  });
});
