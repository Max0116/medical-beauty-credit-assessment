# AI 联网核验规划

## 目标

在业务人员保存评估记录后，系统自动进入后台核验流程，优先用智谱 Web Search 查询公开互联网风险线索，包括行政处罚、失信被执行人、被执行人、医美处罚、非法行医、经营异常等，并把结果沉淀为可追溯的核验日志。

当前产品定位是“公共风险核验”，不是正式金融征信报告。联网结果只提供线索和建议，最终公共信用字段必须由人工确认或授权数据源确认后再写入。

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
- 核验页以轻量联网核验工作台呈现：核验总状态、进度、最近核验时间、搜索结果数、匹配证据数、风险标签、证据链接和系统建议。
- 公共信用状态建议不再提供直接改写按钮；业务人员必须在“核验人工确认”中采用系统建议、人工改判或仅复核留痕，保存后才映射回风控输入字段。
- 核验页支持人工确认闭环：记录采用系统建议、人工改判或仅复核留痕，保存复核人、确认后的公共信用状态、证据链接 / 截图编号、复核说明、核验快照和时间戳。
- 基础页在填写机构名称后提供“保存并核验”快捷动作；保存后全局顶部展示当前机构、核验状态和进度条。
- 统一社会信用代码从服务端官方企业信用接口提取候选值，并由业务人员点击采用；未配置官方接口时不再从智谱搜索摘要中猜测补全。

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

智谱 Web Search 官方接口：

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

后台核验最多取前 7 个关键词，避免一次保存触发过多外部请求。统一社会信用代码和工商信息补全改由官方企业信用接口负责，不再进入智谱关键词列表。

## 轻量核验与深度核验

短期主路径是智谱 `search_std`：每个机构默认查询 7 个风险关键词，按公开价格估算约 0.07 元 / 机构，适合原型验证和早期业务使用。

授权工商 API 只作为深度核验能力预留，不阻塞当前核验流程。PR10 起，页面只在以下场景提示“建议启用授权工商深度核验”：

- 申请额度达到 50,000 元以上。
- 智谱联网核验发现需复核风险线索。
- 合作阶段未满 6 个月。
- 当前评估结果需要特批。

未配置供应商 Key 前，这个开关只做提示，不发起收费查询。

PR8 已将统一社会信用代码补全从“联网搜索摘要提取”改为“服务端官方 / 授权企业信用接口适配”。未来取得企查查 / 天眼查 / 启信宝等供应商 Key 后，Edge Function 通过以下 secrets 连接接口：

```bash
OFFICIAL_REGISTRY_API_URL=https://registry-provider.example.com/search
OFFICIAL_REGISTRY_API_KEY=provider_secret
OFFICIAL_REGISTRY_PROVIDER=official_registry
OFFICIAL_REGISTRY_AUTH_HEADER_NAME=Authorization
OFFICIAL_REGISTRY_AUTH_HEADER_PREFIX=Bearer
```

请求由 Edge Function 发起，不暴露给 H5。默认 POST JSON：

```json
{
  "keyword": "机构名称或统一社会信用代码",
  "institutionName": "机构名称",
  "creditCode": "已有统一社会信用代码"
}
```

适配器兼容常见响应字段，例如 `name` / `enterpriseName`、`creditCode` / `unifiedSocialCreditCode`、`regStatus`、`legalPerson`、`address`、`businessScope`。如果具体供应商字段不同，应只改 `supabase/functions/assessments/officialRegistry.ts` 的映射层，不改前端。

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
- 智谱搜索结果不得自动改写 `publicCreditStatus`、失信、严重违法、重大处罚或超范围经营字段。
- 所有外部返回需要保存 `raw_results`，便于复核。
- AI 提取出的 `riskTags` 只能作为“待核验风险标签”。
- 人工确认日志可以记录业务人员主动采用的公共信用状态建议，但不由后台自动改写评分、红线或授信结论。
- 生产阶段还需要接入真实登录身份、证据附件存储、复核人权限和审批流。

## 后续建议

后续可以继续做：

1. 手动触发补跑：支持对某条评估记录重新核验。
2. Provider 抽象：把智谱调用拆成独立 adapter，方便接入其他 AI API。
3. 深度核验开关：高额度、发现风险、合作未满 6 个月或特批时，再提示使用授权工商 API。
4. 附件闭环：把截图编号升级为 Supabase Storage 附件上传和访问控制。
5. 审批闭环：把复核人扩展为特批审批人、审批意见和审批状态流转。
