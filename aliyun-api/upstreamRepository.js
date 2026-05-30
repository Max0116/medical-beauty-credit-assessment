export function createUpstreamAssessmentRepository({
  upstreamUrl,
  upstreamApiKey,
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = normalizeBaseUrl(upstreamUrl);

  const request = async (clientInstanceId, path, { method = 'GET', body, formData } = {}) => {
    if (!baseUrl) throw new Error('ASSESSMENT_UPSTREAM_URL is not configured.');
    if (!upstreamApiKey) throw new Error('ASSESSMENT_UPSTREAM_API_KEY is not configured.');
    if (!fetchImpl) throw new Error('Fetch API is not available in this Node.js runtime.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(timeoutMs) || 15000);
    try {
      const headers = {
        apikey: upstreamApiKey,
        Authorization: `Bearer ${upstreamApiKey}`,
        'x-client-instance-id': clientInstanceId
      };
      if (!formData) headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: formData || (body === undefined ? undefined : JSON.stringify(body)),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const errorMessage = parseRemoteErrorMessage(text) || `Upstream returned ${response.status}`;
        throw new Error(errorMessage);
      }
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    saveDraft: (clientInstanceId, form) => request(clientInstanceId, '/draft', {
      method: 'PUT',
      body: { form }
    }),
    deleteDraft: (clientInstanceId) => request(clientInstanceId, '/draft', {
      method: 'DELETE'
    }),
    saveRecord: (clientInstanceId, payload) => request(clientInstanceId, '/records', {
      method: 'POST',
      body: { ...payload, clientInstanceId }
    }),
    updateRecord: (clientInstanceId, recordId, payload) => request(clientInstanceId, `/records/${encodeURIComponent(recordId)}`, {
      method: 'PUT',
      body: { ...payload, clientInstanceId }
    }),
    rerunVerification: (clientInstanceId, recordId) => request(clientInstanceId, `/records/${encodeURIComponent(recordId)}/verification`, {
      method: 'POST'
    }),
    saveVerificationReview: (clientInstanceId, recordId, review) => request(clientInstanceId, `/records/${encodeURIComponent(recordId)}/verification-reviews`, {
      method: 'POST',
      body: review
    }),
    uploadEvidenceAttachment: (clientInstanceId, recordId, formData) => request(clientInstanceId, `/records/${encodeURIComponent(recordId)}/verification-attachments`, {
      method: 'POST',
      formData
    })
  };
}

export function createDualWriteAssessmentRepository({ primary, secondary, logger = console } = {}) {
  if (!primary) throw new Error('dual_write repository requires a primary repository.');

  const bestEffort = async (operation, task) => {
    if (!secondary) return null;
    try {
      return await task();
    } catch (error) {
      logger.warn?.(`dual_write secondary ${operation} failed`, error);
      return null;
    }
  };

  return {
    health: async () => {
      const primaryHealth = primary.health ? await primary.health() : { ok: true };
      return {
        ...primaryHealth,
        dualWrite: Boolean(secondary),
        secondary: secondary ? 'supabase_proxy' : 'not_configured'
      };
    },
    loadDraft: (...args) => primary.loadDraft(...args),
    listRecords: (...args) => primary.listRecords(...args),
    loadRecord: (...args) => primary.loadRecord(...args),
    listVerificationLogs: (...args) => primary.listVerificationLogs(...args),
    listVerificationReviews: (...args) => primary.listVerificationReviews(...args),
    saveVerificationLog: (...args) => primary.saveVerificationLog(...args),
    saveDraft: async (clientInstanceId, form) => {
      const result = await primary.saveDraft(clientInstanceId, form);
      await bestEffort('saveDraft', () => secondary.saveDraft(clientInstanceId, form));
      return result;
    },
    deleteDraft: async (clientInstanceId) => {
      const result = await primary.deleteDraft(clientInstanceId);
      await bestEffort('deleteDraft', () => secondary.deleteDraft(clientInstanceId));
      return result;
    },
    saveRecord: async (clientInstanceId, payload) => {
      const result = await primary.saveRecord(clientInstanceId, payload);
      await bestEffort('saveRecord', () => secondary.saveRecord(clientInstanceId, payload));
      return result;
    },
    updateRecord: async (clientInstanceId, recordId, payload) => {
      const result = await primary.updateRecord(clientInstanceId, recordId, payload);
      await bestEffort('updateRecord', () => secondary.updateRecord(clientInstanceId, recordId, payload));
      return result;
    },
    saveVerificationReview: async (clientInstanceId, recordId, review) => {
      const result = await primary.saveVerificationReview(clientInstanceId, recordId, review);
      await bestEffort('saveVerificationReview', () => secondary.saveVerificationReview(clientInstanceId, recordId, review));
      return result;
    }
  };
}

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parseRemoteErrorMessage(text) {
  if (!text) return '';
  try {
    return JSON.parse(text)?.error || '';
  } catch {
    return '';
  }
}
