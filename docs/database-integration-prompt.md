# 数据库衔接提示词建议

## 推荐给数据库/后端接入 Agent 的提示词

你现在要为一个 React + Vite H5 原型接入数据库。项目路径是：

`/Users/maxliu/Documents/Code/medical-beauty-credit-assessment`

这是一个“医美机构账期评估系统”，当前第一版使用 `localStorage` 保存最近草稿和历史记录。请只做数据库衔接，不要重写 UI，不要改动评分规则口径，不要引入登录，除非我明确要求。

请先只做一个窄 PR：

1. 保留 `src/riskEngine.js` 作为唯一风控计算入口。
2. 新增一个数据访问层，例如 `src/assessmentRepository.js`，把当前 `localStorage` 读写封装为统一接口。
3. 接入数据库时，前端只调用这个 repository，不直接在组件里写数据库 SDK 逻辑。
4. 第一阶段支持：
   - 读取最近一次草稿
   - 保存最近一次草稿
   - 保存当前评估记录
   - 获取历史评估记录列表
   - 载入历史评估记录
5. 数据库表建议为 `assessment_records`，字段至少包括：
   - `id`
   - `institution_name`
   - `final_grade`
   - `final_decision`
   - `total_score`
   - `max_term_days`
   - `suggested_limit`
   - `stable_monthly_average`
   - `needs_approval`
   - `redline_reasons`
   - `cap_reasons`
   - `approval_reasons`
   - `form_snapshot`
   - `result_snapshot`
   - `created_at`
   - `updated_at`
6. 如果使用 Supabase：
   - 不要把 service role key 放到前端。
   - 前端只能使用 publishable/anon key。
   - 如果暂时无登录，请说明 RLS 策略的风险和临时限制。
   - 优先设计成“可匿名写入评估记录，但读取范围必须谨慎”的原型策略，或者使用 Edge Function 代写入。
7. 完成后必须验证：
   - 保存记录后刷新页面仍可看到历史记录
   - 草稿能自动恢复
   - `npm test` 通过
   - `npm run build` 通过
   - 手机宽度无横向滚动

注意：这轮不接公共信用联网核验，不做登录，不改 UI 主流程。公共信用核验后续单独作为 PR。

## 推荐数据结构

```sql
create table assessment_records (
  id uuid primary key default gen_random_uuid(),
  institution_name text not null,
  final_grade text not null,
  final_decision text not null,
  total_score integer not null,
  max_term_days integer not null,
  suggested_limit numeric not null,
  stable_monthly_average numeric not null,
  needs_approval boolean not null default false,
  redline_reasons jsonb not null default '[]'::jsonb,
  cap_reasons jsonb not null default '[]'::jsonb,
  approval_reasons jsonb not null default '[]'::jsonb,
  form_snapshot jsonb not null,
  result_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 后续联网核验 PR 边界

联网核验建议单独做第二个 PR，不和数据库保存混在一起。第二个 PR 只负责：

- 新增 `verification_logs`
- 接收机构名称、统一社会信用代码、查询关键词
- 保存人工查询状态或第三方接口返回摘要
- 把核验结果映射回 `publicCreditStatus`、`dishonestyHit`、`seriousIllegalHit`、`majorMedicalPenalty`
- 不改评分规则，只把核验结果输入现有 `evaluateCredit`
