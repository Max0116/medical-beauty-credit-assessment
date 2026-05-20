export const DEFAULT_DEEP_VERIFICATION_HIGH_LIMIT = 50000;

export const parseMoneyConfig = (value, fallback = DEFAULT_DEEP_VERIFICATION_HIGH_LIMIT) => {
  const normalized = String(value ?? '').replace(/[¥￥,\s]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getBusinessConfig = (env = import.meta.env || {}) => ({
  deepVerificationHighLimit: parseMoneyConfig(env.VITE_DEEP_VERIFICATION_HIGH_LIMIT)
});
