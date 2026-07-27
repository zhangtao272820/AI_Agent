import { resolveRenderableEchartsOptionFromText } from '#agent-shared/codeAuthorityPayload'
import { buildEchartsOptionBlock } from '../../../server/graph/core/output/finalOutputBlocks'
import { isRenderableChartOption } from '#agent-shared/chartOption'

const viz = `<!--ECHARTS_OPTION-->
[{"title":"财务健康度指标分析","panels":[{"type":"bar","categories":["月收入","月支出","月结余"],"data":[6000,5000,930],"unit":"currency"}]}]
`

const opt = resolveRenderableEchartsOptionFromText(viz)
if (!opt || !isRenderableChartOption(opt)) throw new Error('panels → echarts failed')
const block = buildEchartsOptionBlock(viz)
if (!block.includes('<!--ECHARTS_OPTION-->') || !block.includes('series')) {
  throw new Error('buildEchartsOptionBlock failed')
}
console.log('smoke-panels-echarts: OK')
