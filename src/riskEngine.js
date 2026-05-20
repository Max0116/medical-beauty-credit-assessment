export const DEFAULT_FORM = {
  institutionName: '',
  creditCode: '',
  businessStage: 'over6Months',
  hasPaidOrders: true,
  paidOrderCount: 8,
  requestedTerm: 21,
  requestedLimit: 30000,
  notes: '',
  licenseValid: true,
  medicalLicenseValid: true,
  beautyScopeIncluded: true,
  subjectConsistent: true,
  qualificationStatus: 'complete',
  monthlyPurchases: [60000, 58000, 61000, 59000, 62000, 60000],
  longestGapDays: 20,
  abnormalLargeOrder: false,
  hasCurrentOverdue: false,
  currentOverdueAmount: 0,
  overTermCount6m: 0,
  maxOverTermDays: 0,
  historicalOverdue: 'none',
  reconciliationDispute: false,
  publicCreditStatus: 'unknown',
  dishonestyHit: false,
  seriousIllegalHit: false,
  majorMedicalPenalty: false,
  outOfScopeOperation: false,
  verificationNotes: ''
};

export const BUSINESS_STAGE_LABELS = {
  new60NoRepayment: '新开 ≤ 60 天且无回款',
  under3Months: '合作 < 3 个月',
  threeToSixMonths: '合作 3-6 个月',
  over6Months: '合作 ≥ 6 个月'
};

export const QUALIFICATION_LABELS = {
  complete: '完整',
  incomplete: '资料不完整',
  coreMissing: '核心缺失'
};

export const PAYMENT_LABELS = {
  none: '无',
  oneToThree: '1-3 天一次',
  fourToSeven: '4-7 天',
  eightToFifteen: '8-15 天或多次',
  overFifteen: '超过 15 天'
};

export const PUBLIC_CREDIT_LABELS = {
  normal: '正常',
  unknown: '未查询 / 无法确认',
  medium: '中等风险',
  serious: '失信 / 严重违法'
};

const GRADE_ORDER = ['E', 'D', 'C', 'B', 'A', 'A+'];

const MAX_TERM_BY_GRADE = {
  'A+': 45,
  A: 30,
  B: 21,
  C: 15,
  D: 7,
  E: 0
};

const LIMIT_RATIO_BY_GRADE = {
  'A+': 1,
  A: 0.8,
  B: 0.6,
  C: 0.4,
  D: 0.2,
  E: 0
};

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const scoreToGrade = (score) => {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'E';
};

const capGrade = (grade, cap) => {
  return GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(cap) ? cap : grade;
};

const roundCurrency = (value) => Math.round(numberValue(value));

const getQueryKeywords = (name) => {
  const baseName = (name || '机构名称').trim() || '机构名称';
  return [
    `${baseName} 行政处罚`,
    `${baseName} 被执行人`,
    `${baseName} 失信被执行人`,
    `${baseName} 医疗美容处罚`,
    `${baseName} 非法行医`,
    `${baseName} 经营异常`,
    `${baseName} 严重违法失信`
  ];
};

const getPurchaseScore = (purchaseMonths, longestGapDays) => {
  if (purchaseMonths >= 5 && longestGapDays <= 45) return 38;
  if (purchaseMonths >= 5) return 35;
  if (purchaseMonths === 4) return 31;
  if (purchaseMonths === 3) return 22;
  if (purchaseMonths >= 1) return 12;
  return 0;
};

const getPaymentScore = (form) => {
  if (form.hasCurrentOverdue || numberValue(form.maxOverTermDays) > 15 || form.historicalOverdue === 'overFifteen') {
    return 0;
  }
  if (form.historicalOverdue === 'oneToThree') return 25;
  if (form.historicalOverdue === 'fourToSeven') return 18;
  if (form.historicalOverdue === 'eightToFifteen') return 10;
  return 30;
};

const getQualificationScore = (status) => {
  if (status === 'complete') return 15;
  if (status === 'incomplete') return 9;
  return 0;
};

const getPublicCreditScore = (status) => {
  if (status === 'normal') return 15;
  if (status === 'unknown') return 8;
  if (status === 'medium') return 6;
  return 0;
};

const getPurchaseHealthTip = (purchaseMonths, longestGapDays) => {
  if (purchaseMonths === 0) return '近 6 个月无有效采购';
  if (purchaseMonths <= 2) return '采购样本偏少，连续性弱';
  if (longestGapDays > 90) return '采购断档超过 90 天';
  if (longestGapDays > 60) return '采购断档超过 60 天';
  if (purchaseMonths >= 5 && longestGapDays <= 45) return '采购连续性良好';
  return '采购连续性中等';
};

const getPaymentTip = (form) => {
  if (form.hasCurrentOverdue) return '当前逾期未结清';
  if (form.historicalOverdue === 'none' && numberValue(form.overTermCount6m) === 0) return '付款履约稳定';
  if (form.historicalOverdue === 'oneToThree') return '存在轻微超账期记录';
  if (form.historicalOverdue === 'fourToSeven') return '存在 4-7 天超账期记录';
  if (form.historicalOverdue === 'eightToFifteen') return '存在 8-15 天或多次超账期记录';
  return '存在超过 15 天超账期记录';
};

const getCreditTip = (form) => {
  if (form.dishonestyHit || form.seriousIllegalHit || form.publicCreditStatus === 'serious') {
    return '公共信用命中红线';
  }
  if (form.publicCreditStatus === 'unknown') return '公共信用待人工核验';
  if (form.publicCreditStatus === 'medium') return '公共信用存在中等风险';
  if (form.majorMedicalPenalty) return '存在重大医美处罚记录';
  return '公共信用正常';
};

export function evaluateCredit(inputForm) {
  const form = {
    ...DEFAULT_FORM,
    ...inputForm,
    monthlyPurchases: Array.from({ length: 6 }, (_, index) => numberValue(inputForm?.monthlyPurchases?.[index]))
  };

  const monthlyTotal = form.monthlyPurchases.reduce((sum, item) => sum + numberValue(item), 0);
  const purchaseMonths = form.monthlyPurchases.filter((item) => numberValue(item) > 0).length;
  const stableMonthlyAverage = roundCurrency(monthlyTotal / 6);
  const longestGapDays = numberValue(form.longestGapDays);
  const requestedTerm = numberValue(form.requestedTerm);
  const requestedLimit = numberValue(form.requestedLimit);
  const paidOrderCount = numberValue(form.paidOrderCount);
  const noRepaymentHistory = !form.hasPaidOrders || paidOrderCount === 0;

  const redlineReasons = [];

  // 业务红线必须先于评分执行；任意红线命中后不进入常规授信。
  if (form.businessStage === 'new60NoRepayment' && noRepaymentHistory) {
    redlineReasons.push('新开机构 ≤ 60 天且无历史回款订单');
  }
  if (form.businessStage === 'under3Months') redlineReasons.push('合作不足 3 个月');
  if (form.hasCurrentOverdue) redlineReasons.push('当前存在逾期未结清');
  if (!form.licenseValid) redlineReasons.push('缺少有效营业执照');
  if (!form.medicalLicenseValid) redlineReasons.push('缺少医疗机构执业许可证或诊所备案凭证');
  if (!form.beautyScopeIncluded) redlineReasons.push('诊疗科目不包含医疗美容相关科目');
  if (form.qualificationStatus === 'coreMissing') redlineReasons.push('核心资质缺失');
  if (form.dishonestyHit) redlineReasons.push('命中失信被执行人');
  if (form.seriousIllegalHit || form.publicCreditStatus === 'serious') redlineReasons.push('命中严重违法失信');
  if (form.outOfScopeOperation) redlineReasons.push('疑似超范围经营或生活美容机构开展注射类项目');

  const componentScores = {
    purchase: getPurchaseScore(purchaseMonths, longestGapDays),
    payment: getPaymentScore(form),
    qualification: getQualificationScore(form.qualificationStatus),
    publicCredit: getPublicCreditScore(form.publicCreditStatus)
  };

  const calculatedScore = Object.values(componentScores).reduce((sum, item) => sum + item, 0);
  const baseGrade = redlineReasons.length ? 'E' : scoreToGrade(calculatedScore);
  const capReasons = [];
  let finalGrade = baseGrade;

  // 封顶规则在评分之后执行，用于把基础等级修正为最终等级。
  const applyCap = (cap, reason) => {
    const nextGrade = capGrade(finalGrade, cap);
    if (nextGrade !== finalGrade || !capReasons.includes(reason)) {
      finalGrade = nextGrade;
      capReasons.push(reason);
    }
  };

  if (!redlineReasons.length) {
    if (form.businessStage === 'threeToSixMonths') applyCap('C', '合作 3-6 个月，最高 C');
    if (purchaseMonths < 4) applyCap('C', '近 6 个月采购月份少于 4 个月，最高 C');
    if (longestGapDays > 90) applyCap('D', '最长采购断档 > 90 天，最高 D');
    else if (longestGapDays > 60) applyCap('C', '最长采购断档 > 60 天，最高 C');
    if (form.historicalOverdue === 'oneToThree') applyCap('A', '1 次 1-3 天轻微超账期，最高 A');
    if (form.historicalOverdue === 'fourToSeven') applyCap('B', '4-7 天超账期，最高 B');
    if (form.historicalOverdue === 'eightToFifteen') applyCap('C', '8-15 天超账期或多次超账期，最高 C');
    if (form.historicalOverdue === 'overFifteen' || numberValue(form.maxOverTermDays) > 15) {
      applyCap('D', '单次超过 15 天超账期，最高 D');
    }
    if (form.publicCreditStatus === 'unknown') applyCap('C', '公共信用未查询 / 无法确认，最高 C');
    if (form.qualificationStatus === 'incomplete') applyCap('C', '资质资料不完整，最高 C');
    if (form.majorMedicalPenalty) applyCap('D', '存在重大医美处罚，最高 D');
  }

  if (redlineReasons.length) finalGrade = 'E';

  const maxTermDays = MAX_TERM_BY_GRADE[finalGrade];
  const creditLimitCap = finalGrade === 'E' ? 0 : stableMonthlyAverage;
  const suggestedLimit = finalGrade === 'E'
    ? 0
    : Math.min(roundCurrency(stableMonthlyAverage * LIMIT_RATIO_BY_GRADE[finalGrade]), creditLimitCap);

  const approvalReasons = [];
  if (!redlineReasons.length) {
    if (requestedTerm > maxTermDays) approvalReasons.push('申请账期超过等级最长账期');
    if (requestedLimit > stableMonthlyAverage) approvalReasons.push('申请额度超过稳定月均销量');
    if (form.historicalOverdue !== 'none' || numberValue(form.overTermCount6m) > 0 || numberValue(form.maxOverTermDays) > 0) {
      approvalReasons.push('存在历史超账期记录');
    }
    if (form.publicCreditStatus === 'unknown') approvalReasons.push('公共信用未查询或无法确认');
    if (form.qualificationStatus === 'incomplete') approvalReasons.push('资质资料不完整');
    if (form.abnormalLargeOrder) approvalReasons.push('存在单月异常大单');
    if (form.reconciliationDispute) approvalReasons.push('存在对账争议');
    if (form.majorMedicalPenalty) approvalReasons.push('存在重大医美处罚');
    if ((form.businessStage === 'new60NoRepayment' || form.businessStage === 'threeToSixMonths') && requestedTerm > 0) {
      approvalReasons.push('合作未满 6 个月但业务仍申请账期');
    }
  }

  const needsApproval = approvalReasons.length > 0;
  let finalDecision = '正常授信';
  if (finalGrade === 'E') {
    finalDecision = '不建议授信';
  } else if (finalGrade === 'C' || finalGrade === 'D') {
    finalDecision = needsApproval ? '谨慎短账期，需特批' : '谨慎短账期';
  } else {
    finalDecision = needsApproval ? '正常授信，需特批' : '正常授信';
  }

  const extraRiskReasons = [];
  if (!form.subjectConsistent) extraRiskReasons.push('主体 / 地址 / 合同 / 付款 / 收货链条不一致');

  return {
    componentScores,
    totalScore: redlineReasons.length ? 0 : calculatedScore,
    baseGrade,
    finalGrade,
    finalDecision,
    maxTermDays,
    suggestedLimit,
    creditLimitCap,
    stableMonthlyAverage,
    purchaseMonths,
    monthlyTotal: roundCurrency(monthlyTotal),
    needsApproval,
    redlineReasons,
    capReasons,
    approvalReasons,
    extraRiskReasons,
    purchaseHealthTip: getPurchaseHealthTip(purchaseMonths, longestGapDays),
    paymentTip: getPaymentTip(form),
    creditTip: getCreditTip(form),
    queryKeywords: getQueryKeywords(form.institutionName),
    requestedTerm,
    requestedLimit
  };
}
