import { BUSINESS_STAGE_LABELS, PUBLIC_CREDIT_LABELS } from './riskEngine';

const REPORT_WIDTH = 750;
const REPORT_PADDING = 42;
const REPORT_CONTENT_WIDTH = REPORT_WIDTH - REPORT_PADDING * 2;
const REPORT_LINE_HEIGHT = 30;
const REPORT_SECTION_GAP = 24;
const REPORT_CARD_RADIUS = 18;

const money = (value) => `¥${Math.round(Number(value) || 0).toLocaleString('zh-CN')}`;

export function formatReportDateTime(value, fallback = '未记录') {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('zh-CN', { hour12: false });
}

const unique = (items = []) => [...new Set(items.filter(Boolean))];

const labelOr = (value, fallback = '未记录') => {
  const text = String(value || '').trim();
  return text || fallback;
};

export function buildApprovalReportData({
  form,
  result,
  assessmentStage,
  latestVerificationSummary,
  verificationReviews = [],
  generatedAt = new Date()
}) {
  const latestReview = verificationReviews[0] || null;
  const riskReasons = unique([
    ...(result.redlineReasons || []),
    ...(result.capReasons || []),
    ...(result.approvalReasons || []),
    ...(result.extraRiskReasons || [])
  ]);
  const evidenceItems = Array.isArray(latestVerificationSummary?.evidenceSummaries)
    ? latestVerificationSummary.evidenceSummaries.slice(0, 4)
    : [];
  const riskTags = Array.isArray(latestVerificationSummary?.riskTags)
    ? latestVerificationSummary.riskTags
    : [];

  return {
    title: '医美机构账期授信审批摘要',
    generatedAt: formatReportDateTime(generatedAt),
    institution: {
      name: labelOr(form.institutionName, '未填写机构名称'),
      creditCode: labelOr(form.creditCode, '未填写'),
      stage: labelOr(BUSINESS_STAGE_LABELS[form.businessStage], '未记录')
    },
    decision: {
      finalDecision: result.finalDecision,
      finalGrade: result.finalGrade,
      totalScore: `${result.totalScore} 分`,
      maxTermDays: `${result.maxTermDays} 天`,
      suggestedLimit: money(result.suggestedLimit),
      creditLimitCap: money(result.creditLimitCap),
      stableMonthlyAverage: money(result.stableMonthlyAverage),
      requestedTerm: `${result.requestedTerm} 天`,
      requestedLimit: money(result.requestedLimit)
    },
    verification: {
      stageTitle: labelOr(assessmentStage?.title, '预评估'),
      stageScope: labelOr(assessmentStage?.decisionScope, '当前结论仅供内部参考'),
      statusLabel: labelOr(latestVerificationSummary?.judgmentLabel, '未生成核验结论'),
      conclusion: labelOr(latestVerificationSummary?.conclusion, '暂无联网核验摘要'),
      riskTags,
      reviewStatus: latestReview ? '已人工确认' : '未人工确认',
      reviewerName: latestReview?.reviewerName || '未记录',
      reviewerDecision: PUBLIC_CREDIT_LABELS[latestReview?.reviewerDecision] || latestReview?.reviewerDecision || '',
      reviewedAt: formatReportDateTime(latestReview?.createdAt),
      evidenceNote: latestReview?.evidenceNote || '',
      evidenceUrl: latestReview?.evidenceUrl || '',
      evidenceAttachments: Array.isArray(latestReview?.evidenceAttachments) ? latestReview.evidenceAttachments : []
    },
    riskReasons,
    evidenceInsight: latestVerificationSummary?.evidenceInsight || null,
    evidenceItems,
    footer: '系统生成摘要仅用于内部审批流转；联网线索需结合原文、截图和人工复核留存。'
  };
}

export function buildApprovalReportText(report) {
  const lines = [
    report.title,
    `生成时间：${report.generatedAt}`,
    '',
    `机构：${report.institution.name}`,
    `统一社会信用代码：${report.institution.creditCode}`,
    `经营 / 合作阶段：${report.institution.stage}`,
    `结论性质：${report.verification.stageTitle}`,
    '',
    `最终判断：${report.decision.finalDecision}`,
    `最终等级：${report.decision.finalGrade}`,
    `综合评分：${report.decision.totalScore}`,
    `建议账期：${report.decision.maxTermDays}`,
    `建议额度：${report.decision.suggestedLimit}`,
    `额度上限：${report.decision.creditLimitCap}`,
    `稳定月均销量：${report.decision.stableMonthlyAverage}`,
    `业务申请：${report.decision.requestedTerm} / ${report.decision.requestedLimit}`,
    '',
    `核验状态：${report.verification.statusLabel}`,
    `人工确认：${report.verification.reviewStatus}`,
    `复核人：${report.verification.reviewerName}`,
    `复核时间：${report.verification.reviewedAt}`,
    `复核结论：${report.verification.reviewerDecision || '未记录'}`,
    '',
    '系统原因：',
    ...(report.riskReasons.length ? report.riskReasons.map((item) => `- ${item}`) : ['- 未发现明显风险标签']),
    '',
    '联网核验摘要：',
    `- ${report.verification.conclusion}`
  ];

  if (report.evidenceInsight?.overview) {
    lines.push(`- AI 摘要：${report.evidenceInsight.overview}`);
  }

  if (report.evidenceItems.length) {
    lines.push('', '证据来源：');
    report.evidenceItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${labelOr(item.title, '未命名来源')}｜${labelOr(item.source || item.sourceHost, '来源待确认')}`);
      if (item.url) lines.push(`   ${item.url}`);
    });
  }

  if (report.verification.evidenceUrl || report.verification.evidenceAttachments.length) {
    lines.push('', '人工留痕：');
    if (report.verification.evidenceUrl) lines.push(`- ${report.verification.evidenceUrl}`);
    report.verification.evidenceAttachments.forEach((attachment) => {
      lines.push(`- ${labelOr(attachment.fileName, '证据附件')}`);
      if (attachment.signedUrl) lines.push(`  ${attachment.signedUrl}`);
    });
  }

  lines.push('', report.footer);
  return lines.join('\n');
}

export async function exportApprovalReportImage(report) {
  const canvas = renderApprovalReportCanvas(report);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.96));
  if (!blob) throw new Error('长截图生成失败');

  const fileName = `${sanitizeFileName(report.institution.name)}-授信审批摘要.png`;
  const file = typeof File !== 'undefined'
    ? new File([blob], fileName, { type: 'image/png' })
    : null;

  if (file && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: report.title,
      text: `${report.institution.name} ${report.decision.finalDecision}`
    });
    return { mode: 'share', fileName };
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  return { mode: 'download', fileName };
}

function renderApprovalReportCanvas(report) {
  const layout = createReportLayout(report);
  const scale = Math.max(2, Math.floor(window.devicePixelRatio || 2));
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_WIDTH * scale;
  canvas.height = layout.height * scale;
  canvas.style.width = `${REPORT_WIDTH}px`;
  canvas.style.height = `${layout.height}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#f6f1fb';
  ctx.fillRect(0, 0, REPORT_WIDTH, layout.height);
  drawReport(ctx, report, layout);
  return canvas;
}

function createReportLayout(report) {
  const textBlocks = [
    report.institution.name,
    report.verification.stageScope,
    report.verification.conclusion,
    report.evidenceInsight?.overview || '',
    report.footer,
    ...report.riskReasons,
    ...report.evidenceItems.flatMap((item) => [item.title, item.source, item.snippet, item.url])
  ];
  const estimatedLines = textBlocks.reduce((sum, item) => sum + wrapText(String(item || ''), 32).length, 0);
  const evidenceHeight = Math.max(130, report.evidenceItems.length * 74);
  const reasonHeight = Math.max(96, (report.riskReasons.length || 1) * 30 + 42);
  const insightHeight = report.evidenceInsight?.overview ? 130 : 84;
  const height = 920 + evidenceHeight + reasonHeight + insightHeight + estimatedLines * 2;
  return { height };
}

function drawReport(ctx, report, layout) {
  let y = REPORT_PADDING;
  drawHeader(ctx, report, y);
  y += 132;
  y = drawDecisionCard(ctx, report, y);
  y = drawInfoSection(ctx, '机构与申请', [
    ['机构名称', report.institution.name],
    ['统一社会信用代码', report.institution.creditCode],
    ['经营 / 合作阶段', report.institution.stage],
    ['业务申请账期', report.decision.requestedTerm],
    ['业务申请额度', report.decision.requestedLimit],
    ['稳定月均销量', report.decision.stableMonthlyAverage],
    ['额度上限', report.decision.creditLimitCap]
  ], y);
  y = drawInfoSection(ctx, '核验与人工确认', [
    ['结论性质', report.verification.stageTitle],
    ['核验判断', report.verification.statusLabel],
    ['人工确认', report.verification.reviewStatus],
    ['复核人', report.verification.reviewerName],
    ['复核时间', report.verification.reviewedAt],
    ['复核结论', report.verification.reviewerDecision || '未记录']
  ], y);
  y = drawBulletSection(ctx, '系统原因', report.riskReasons.length ? report.riskReasons : ['未发现明显风险标签'], y);
  y = drawParagraphSection(ctx, '联网核验摘要', [
    report.verification.conclusion,
    report.evidenceInsight?.overview ? `AI 摘要：${report.evidenceInsight.overview}` : '',
    report.verification.evidenceNote ? `复核说明：${report.verification.evidenceNote}` : '',
    report.verification.evidenceUrl ? `证据链接：${report.verification.evidenceUrl}` : ''
  ].filter(Boolean), y);
  y = drawEvidenceSection(ctx, report.evidenceItems, y);
  drawFooter(ctx, report.footer, Math.min(y + REPORT_SECTION_GAP, layout.height - 92));
}

function drawHeader(ctx, report, y) {
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, REPORT_PADDING, y, REPORT_CONTENT_WIDTH, 108, REPORT_CARD_RADIUS);
  ctx.fill();
  drawText(ctx, report.title, REPORT_PADDING + 24, y + 36, { size: 30, weight: 800, color: '#2c2638' });
  drawText(ctx, `生成时间 ${report.generatedAt}`, REPORT_PADDING + 24, y + 76, { size: 18, weight: 700, color: '#786f86' });
}

function drawDecisionCard(ctx, report, y) {
  const tone = report.decision.finalGrade === 'E'
    ? { bg: '#fff0f2', border: '#e9b7bf', color: '#b83243' }
    : { bg: '#edf9f3', border: '#b8dfcf', color: '#188262' };
  ctx.fillStyle = tone.bg;
  roundRect(ctx, REPORT_PADDING, y, REPORT_CONTENT_WIDTH, 164, REPORT_CARD_RADIUS);
  ctx.fill();
  ctx.strokeStyle = tone.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, report.decision.finalDecision, REPORT_PADDING + 24, y + 42, { size: 30, weight: 900, color: tone.color });
  drawText(ctx, `等级 ${report.decision.finalGrade}`, REPORT_PADDING + REPORT_CONTENT_WIDTH - 176, y + 44, { size: 32, weight: 900, color: '#2c2638' });
  const metrics = [
    ['综合评分', report.decision.totalScore],
    ['建议账期', report.decision.maxTermDays],
    ['建议额度', report.decision.suggestedLimit]
  ];
  metrics.forEach(([label, value], index) => {
    const x = REPORT_PADDING + 24 + index * 210;
    drawText(ctx, label, x, y + 96, { size: 17, weight: 800, color: '#786f86' });
    drawText(ctx, value, x, y + 130, { size: 24, weight: 900, color: '#2c2638' });
  });
  return y + 164 + REPORT_SECTION_GAP;
}

function drawInfoSection(ctx, title, rows, y) {
  const rowHeight = 54;
  const height = 62 + Math.ceil(rows.length / 2) * rowHeight;
  drawSectionCard(ctx, title, y, height);
  rows.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = REPORT_PADDING + 24 + col * 330;
    const itemY = y + 70 + row * rowHeight;
    drawText(ctx, label, x, itemY, { size: 16, weight: 800, color: '#786f86' });
    drawText(ctx, String(value), x, itemY + 26, { size: 19, weight: 900, color: '#2c2638', maxWidth: 292 });
  });
  return y + height + REPORT_SECTION_GAP;
}

function drawBulletSection(ctx, title, items, y) {
  const lines = items.flatMap((item) => wrapText(item, 36));
  const height = 62 + lines.length * REPORT_LINE_HEIGHT + 12;
  drawSectionCard(ctx, title, y, height);
  let itemY = y + 74;
  items.forEach((item) => {
    wrapText(item, 34).forEach((line, index) => {
      drawText(ctx, `${index === 0 ? '• ' : '  '}${line}`, REPORT_PADDING + 24, itemY, { size: 18, weight: 700, color: '#2c2638' });
      itemY += REPORT_LINE_HEIGHT;
    });
  });
  return y + height + REPORT_SECTION_GAP;
}

function drawParagraphSection(ctx, title, paragraphs, y) {
  const lines = paragraphs.flatMap((item) => wrapText(item, 36));
  const height = 62 + lines.length * REPORT_LINE_HEIGHT + 18;
  drawSectionCard(ctx, title, y, height);
  let itemY = y + 74;
  paragraphs.forEach((paragraph) => {
    wrapText(paragraph, 36).forEach((line) => {
      drawText(ctx, line, REPORT_PADDING + 24, itemY, { size: 18, weight: 700, color: '#2c2638' });
      itemY += REPORT_LINE_HEIGHT;
    });
    itemY += 6;
  });
  return y + height + REPORT_SECTION_GAP;
}

function drawEvidenceSection(ctx, evidenceItems, y) {
  const items = evidenceItems.length ? evidenceItems : [{ title: '暂无结构化证据卡片', source: '可补充人工截图或链接' }];
  const height = 62 + items.length * 78 + 12;
  drawSectionCard(ctx, '证据摘要', y, height);
  let itemY = y + 74;
  items.forEach((item, index) => {
    drawText(ctx, `${index + 1}. ${labelOr(item.title, '未命名来源')}`, REPORT_PADDING + 24, itemY, { size: 18, weight: 900, color: '#2c2638', maxWidth: 608 });
    itemY += 28;
    drawText(ctx, labelOr([item.source, item.sourceHost, item.publishDate].filter(Boolean).join(' · '), '来源待确认'), REPORT_PADDING + 24, itemY, { size: 16, weight: 700, color: '#786f86', maxWidth: 610 });
    itemY += 24;
    if (item.url) {
      drawText(ctx, item.url, REPORT_PADDING + 24, itemY, { size: 14, weight: 700, color: '#6140a5', maxWidth: 610 });
    }
    itemY += 26;
  });
  return y + height + REPORT_SECTION_GAP;
}

function drawSectionCard(ctx, title, y, height) {
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, REPORT_PADDING, y, REPORT_CONTENT_WIDTH, height, REPORT_CARD_RADIUS);
  ctx.fill();
  ctx.strokeStyle = '#e6dff0';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawText(ctx, title, REPORT_PADDING + 24, y + 38, { size: 22, weight: 900, color: '#2c2638' });
}

function drawFooter(ctx, text, y) {
  wrapText(text, 42).forEach((line, index) => {
    drawText(ctx, line, REPORT_PADDING, y + index * 24, { size: 16, weight: 700, color: '#786f86' });
  });
}

function drawText(ctx, text, x, y, options = {}) {
  const {
    size = 18,
    weight = 700,
    color = '#2c2638',
    maxWidth
  } = options;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Inter, PingFang SC, Microsoft YaHei, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  if (maxWidth) {
    ctx.fillText(String(text || ''), x, y, maxWidth);
  } else {
    ctx.fillText(String(text || ''), x, y);
  }
}

function wrapText(text, maxChars) {
  const source = String(text || '').trim();
  if (!source) return [];
  const lines = [];
  let current = '';
  Array.from(source).forEach((char) => {
    current += char;
    if (current.length >= maxChars || char === '\n') {
      lines.push(current.trim());
      current = '';
    }
  });
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function sanitizeFileName(value) {
  return labelOr(value, '未命名机构').replace(/[\\/:*?"<>|]/g, '-').slice(0, 48);
}
