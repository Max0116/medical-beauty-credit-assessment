# AI 联网核验规划

## 目标

在业务人员保存评估记录后，系统自动进入后台核验流程，围绕机构名称和统一社会信用代码查询公共信用、行政处罚、失信被执行人、医美处罚、非法行医、经营异常等风险线索，并把结果沉淀为可追溯的核验日志。

第一阶段不直接改风控规则，只保存核验结果和风险标签。人工确认后，再把核验结论映射回现有输入字段：

- `publicCreditStatus`
- `dishonestyHit`
- `seriousIllegalHit`
- `majorMedicalPenalty`
- `outOfScopeOperation`
- `verificationNotes`

## 当前已落地范围

- 新增 `verification_logs` 表。
- 保存评估记录时自动创建核验日志。
- 如果 Supabase Edge Function 配置了 `ZHIPUAI_API_KEY`，保存记录后通过 `EdgeRuntime.waitUntil` 触发后台智谱 Web Search。
- 如果没有配置智谱 API Key，核验日志保持 `pending`，后续可人工或定时任务补跑。
- 后台会把智谱搜索结果整理为 `verificationSummary`，包括 `judgment`、`judgmentLabel`、`riskLevel`、`conclusion`、`recommendation`、`suggestedPublicCreditStatus` 和 `evidenceSummaries`。
- 核验页会展示自动征信判断、搜索结果数、匹配证据数、风险标签和证据链接，并允许业务人员手动采用公共信用状态建议。
- 核验页支持人工确认闭环：记录采用系统建议、人工改判或仅复核留痕，保存复核人、确认后的公共信用状态、证据链接 / 截图编号、复核说明、核验快照和时间戳。

## 证据判断原则

后台核验不能把查询关键词本身当作风险命中。比如搜索词包含“失信被执行人”，但搜索结果标题和正文没有匹配机构名称时，不生成风险标签。

当前规则只在同时满足以下条件时生成风险证据：

1. 搜索结果标题或正文能匹配机构名称，或匹配去除“有限公司 / 医疗美容诊所 / 门诊部 / 医院”等后缀后的核心名称。
2. 搜索结果标题或正文出现风险语义：失信被执行人、严重违法失信、被执行人、行政处罚、医美处罚、非法行医、经营异常。

判断分为：

- `clear`：未发现与机构名称直接匹配的明显负面结果。
- `review_required`：发现被执行人、行政处罚、经营异常等需人工复核线索。
- `redline_suspected`：发现失信、严重违法失信、非法行医、医美处罚等疑似红线线索。
- `pending` / `failed` / `skipped`：核验等待、失败或未发起。

## 智谱 Web Search 接入

官方接口：

```http
POST https://open.bigmodel.cn/api/paas/v4/web_search
Authorization: Bearer <ZHIPUAI_API_KEY>
Content-Type: application/json
```

核心参数：

- `search_query`：单次搜索关键词，建议不超过 70 字符。
- `search_engine`：建议第一版用 `search_std`，稳定后再评估 `search_pro`。
- `search_intent`：第一版用 `false`，避免搜索意图改写影响风控可追溯。
- `count`：第一版每个关键词取 5 条。
- `content_size`：第一版用 `medium`。
- `user_id`：传 `clientInstanceId`，用于供应商侧滥用识别。

官方响应中的 `search_result` 包含标题、摘要、链接、媒体名称和发布时间，适合保存为核验原始证据。

## 查询关键词

沿用前端当前生成规则：

- 机构名称 + 行政处罚
- 机构名称 + 被执行人
- 机构名称 + 失信被执行人
- 机构名称 + 医疗美容处罚
- 机构名称 + 非法行医
- 机构名称 + 经营异常
- 机构名称 + 严重违法失信

第一版后台核验最多取前 5 个关键词，避免一次保存触发过多外部请求。

## 多 AI / 多搜索源规划

建议把核验能力做成 Provider Adapter：

| Provider | 用途 | 放置位置 |
| --- | --- | --- |
| `zhipu_web_search` | 中文互联网搜索，第一优先级 | Supabase Edge Function |
| `bocha_search` | 备用中文搜索源 | 后续 Provider |
| `tavily_search` | 通用 Web Search，适合英文和结构化结果 | 后续 Provider |
| `exa_search` | 高质量网页检索和内容摘要 | 后续 Provider |
| `manual_review` | 人工截图 / 人工查询留痕 | 管理端或核验页 |
| `official_registry` | 企业信用、执行信息、卫健委等正式接口 | 正式生产阶段 |

Provider 输出统一为：

```json
{
  "provider": "zhipu_web_search",
  "queryKeywords": [],
  "rawResults": [],
  "riskTags": [],
  "extractedFlags": {
    "dishonestyHit": false,
    "seriousIllegalHit": false,
    "majorMedicalPenalty": false,
    "sourceCount": 0,
    "matchedSourceCount": 0,
    "verificationSummary": {}
  }
}
```

## 风控使用原则

- AI 联网核验只提供线索，不直接做最终拒绝。
- 红线字段必须由人工确认或可信官方接口确认后再写入评估输入。
- 所有外部返回需要保存 `raw_results`，便于复核。
- AI 提取出的 `riskTags` 只能作为“待核验风险标签”。
- 人工确认日志可以记录业务人员主动采用的公共信用状态建议，但不由后台自动改写评分、红线或授信结论。
- 生产阶段还需要接入真实登录身份、证据附件存储、复核人权限和审批流。

## 后续建议

后续可以继续做：

1. 手动触发补跑：支持对某条评估记录重新核验。
2. Provider 抽象：把智谱调用拆成独立 adapter，方便接入其他 AI API。
3. 官方接口优先级：接入企业信用、执行信息、卫健委处罚等可信接口后，用官方结果覆盖 AI 搜索线索。
4. 附件闭环：把截图编号升级为 Supabase Storage 附件上传和访问控制。
5. 审批闭环：把复核人扩展为特批审批人、审批意见和审批状态流转。
