/**
 * DB prefetch 对齐 smoke（纯函数 + 可选 LLM）。
 */
import { judgeDbPrefetchAlignment } from '../../../server/utils/db/managerDbPrefetchAlignLlm'
import { resolveDbPrefetchQuestionFromState, resolveDbStepQuestionSync } from '../../../server/graph/core/db/dbStepQuestion'
import { collectSubAgentScopeCandidates, pickSubAgentScopeSync } from '../../../server/utils/route/managerSubAgentScopeLlm.ts'
import { enrichManagerDbTaskFromPrefetch, stripMisalignedPrefetchFromManagerTask } from '../../../server/utils/db/managerDbPrefetchReuse'
import { pickRichestDbQuestion } from '../../../server/utils/db/managerDbQuestionLlm'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

async function main() {
  const { buildManagerAdminTaskPayload } = await import('../../../server/utils/admin/managerAdminTaskPayload.ts')

  const e4User =
    '知识库查失能老人护理员配比，数据库查王建国的慢性病检测记录，对比分析并出图。并告诉我坐地铁从天津西站到天津站大概多久'
  const e4DbClause = '数据库查王建国慢性病检测记录'
  const e4Meta = {
    intent: 'multi',
    stepDispatchDraft: [
      { agent: 'rag', scopedUserLanguage: '知识库查失能老人护理员配比标准' },
      { agent: 'db', scopedUserLanguage: e4DbClause },
      { agent: 'admin', scopedUserLanguage: '坐地铁从天津西站到天津站大概多久' }
    ],
    dbPlanPrefetch: {
      ok: true,
      question: e4DbClause,
      unified_task_plan: {
        hints: { suggested_tables: ['remote_nursing_chronic'], evidence: '王建国' },
        entities: { names: ['王建国'] },
        query_plan_json: JSON.stringify({
          intent: 'detail',
          confidence: 0.82,
          entities: { names: ['王建国'], locations: [], orgs: [], ids: [] },
          metrics: ['慢性病检测记录']
        }),
        prefetch_ready: true
      }
    }
  }

  const e4ExecQ = resolveDbStepQuestionSync(e4DbClause, e4User, e4Meta)
  assert(e4ExecQ.includes('王建国'), `E4 exec should stay scoped, got: ${e4ExecQ}`)
  assert(!e4ExecQ.includes('知识库'), `E4 exec must not include rag clause, got: ${e4ExecQ}`)

  const e4PrefetchQ = resolveDbPrefetchQuestionFromState(
    { meta: e4Meta, routedQuery: e4User, intent: 'multi' },
    e4User,
    e4User
  )
  assert(e4PrefetchQ.includes('王建国'), `E4 prefetch should use draft, got: ${e4PrefetchQ}`)

  const e4Aligned = await judgeDbPrefetchAlignment({
    prefetchQuestion: e4PrefetchQ,
    execQuestion: e4ExecQ,
    userTask: e4User,
    suggestedTables: ['remote_nursing_chronic']
  })
  assert(e4Aligned.aligned === true, `E4 prefetch/exec should align, got: ${e4Aligned.rationale}`)

  const locked = pickRichestDbQuestion(e4DbClause, e4User, undefined, { lockOrchestratedScope: true })
  assert(locked === e4DbClause, `scoped db must not expand to full user task, got: ${locked}`)

  const expandedBack = pickRichestDbQuestion(e4User, e4User, undefined, { meta: e4Meta })
  assert(expandedBack.includes('王建国'), `meta lock must recover scoped db from full user, got: ${expandedBack}`)
  assert(!expandedBack.includes('知识库'), `meta lock must not keep full compound, got: ${expandedBack}`)

  const adminPayload = buildManagerAdminTaskPayload({
    actionText: '坐地铁从天津西站到天津站大概多久',
    meta: e4Meta
  })
  assert(adminPayload.action_text.includes('天津西站'), 'admin scoped action_text')
  assert(!adminPayload.tool_plan?.length, 'admin sidecar must not regex-infer tool_plan')

  const compoundUser =
    '知识库查失能老人补贴和高龄津贴标准，数据库查河西区70-79岁老人性别分布，写一份对比报告。'
  const dbClause = '数据库查河西区70-79岁老人性别分布'

  const meta = {
    intent: 'multi',
    taskClauses: [
      { id: 'c1', text: '知识库查失能老人补贴和高龄津贴标准', agents: ['rag'] },
      { id: 'c2', text: dbClause, agents: ['db'] }
    ],
    planBlueprint: {
      steps: [
        { agent: 'rag', queryFocus: '知识库查失能老人补贴和高龄津贴标准' },
        { agent: 'db', queryFocus: dbClause },
        { agent: 'report', queryFocus: '写一份对比报告' }
      ]
    },
    dbPlanPrefetch: {
      ok: true,
      question: dbClause,
      unified_task_plan: {
        hints: {
          suggested_tables: ['person_info'],
          evidence: '河西区 老人 性别分布'
        },
        entities: { locations: ['河西区'] },
        query_plan_json: JSON.stringify({
          intent: 'aggregation',
          confidence: 0.85,
          entities: { names: [], locations: ['河西区'], orgs: [], ids: [] },
          dimensions: ['性别'],
          metrics: ['分布']
        }),
        prefetch_ready: true
      }
    }
  }

  const execQ = resolveDbStepQuestionSync('从数据库查询：河西区70-79岁老人性别分布', compoundUser, meta)
  assert(execQ.includes('河西区'), `exec question should be db clause, got: ${execQ}`)

  const prefetchQ = resolveDbPrefetchQuestionFromState(
    { meta, routedQuery: compoundUser, intent: 'multi' },
    compoundUser,
    compoundUser
  )
  assert(prefetchQ.includes('河西区'), `prefetch should use db focus, got: ${prefetchQ}`)

  const misaligned = await judgeDbPrefetchAlignment({
    prefetchQuestion: compoundUser,
    execQuestion: execQ,
    userTask: compoundUser,
    suggestedTables: ['dify_knowledge_doc']
  })
  assert(misaligned.aligned === false, 'whole-task prefetch must not align with db-only exec')

  const aligned = await judgeDbPrefetchAlignment({
    prefetchQuestion: execQ,
    execQuestion: execQ,
    userTask: compoundUser
  })
  assert(aligned.aligned === true, 'same db question should align')

  const poisoned = enrichManagerDbTaskFromPrefetch(
    { source: 'manager', refined_question: execQ, must_filters: [], schema_search_keywords: '' },
    meta,
    { allowReuse: true }
  )
  // 仅 hints、无 judge_source=llm：可下发候选，但不得锁 primary（prefetch_reuse）
  assert((poisoned?.hint_tables ?? []).includes('person_info'), 'aligned reuse still passes hint tables')
  assert(poisoned?.prefetch_reuse !== true, 'without llm table judge must not lock prefetch_reuse')
  assert(
    !String(poisoned?.prefetch_schema_ground_json || '').includes('primary_tables'),
    'must not fabricate primary_tables from suggested_tables'
  )

  const withLlmJudge = enrichManagerDbTaskFromPrefetch(
    { source: 'manager', refined_question: execQ, must_filters: [], schema_search_keywords: '' },
    {
      ...meta,
      dbPlanPrefetch: {
        ...meta.dbPlanPrefetch,
        unified_task_plan: {
          ...meta.dbPlanPrefetch.unified_task_plan,
          schema_ground_json: JSON.stringify({
            candidate_tables: ['person_info'],
            table_judge: {
              ranked_tables: ['person_info'],
              primary_tables: ['person_info'],
              auxiliary_tables: [],
              reasoning: '人口统计主表',
              sql_hint: '',
              judge_source: 'llm'
            }
          })
        }
      }
    },
    { allowReuse: true }
  )
  assert(withLlmJudge?.prefetch_reuse === true, 'llm judge_source enables prefetch_reuse')

  const cleaned = stripMisalignedPrefetchFromManagerTask(withLlmJudge)
  assert(!cleaned?.prefetch_reuse, 'strip removes prefetch_reuse')
  assert(!cleaned?.prefetch_schema_ground_json, 'strip removes schema json')

  const genericMeta = {
    intent: 'multi',
    planBlueprint: { steps: [{ agent: 'db', queryFocus: '从数据库查询结构化数据' }] },
    taskClauses: [{ id: 'c1', text: '数据库查河西区老人人数', agents: ['db'] }]
  }
  const genericCandidates = collectSubAgentScopeCandidates('db', genericMeta, '从数据库查询：河西区老人人数')
  const genericPicked = pickSubAgentScopeSync(genericCandidates)
  assert(genericPicked.includes('河西区'), `generic blueprint must fall back to clause via scope priority, got: ${genericPicked}`)

  console.log('smoke-db-prefetch-align: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
