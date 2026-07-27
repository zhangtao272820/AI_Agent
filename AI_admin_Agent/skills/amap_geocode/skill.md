---
name: amap_geocode
description: 高德地址解析与补全
version: 1.0.0
stage: planning
owner: ai_admin_agent
---

## Planning

用户问「这个地址在哪」「帮我查地址」「补全地址」时：

| 场景 | 工具 |
|------|------|
| 模糊地址 → 标准地址 + 坐标 | `resolve_address_amap(address, city?)` |
| 输入一半要补全 | `suggest_address_amap(keywords, city?)` |
| 坐标 → 文字地址 | `locate_coordinates_amap("经度,纬度")` |

示例：
- 「滨海新区第二大街 18 号在哪」→ `resolve_address_amap(...)`
- 「南开区水上公园」→ `suggest_address_amap("水上公园", "天津")`

安排会议/日程前地址不确定时，可先 `suggest_address_amap` 再 `resolve_address_amap` 确认。

## Reply

界面会展示地址/地图卡片；**文字回复由汇总模型撰写**：
- 用自然语言确认标准地址或补全候选，说明是否可用于导航/约会选址。
- 多条补全结果时提示用户选哪一条或补充门牌号；给 1 条实用建议。
- 80～180 字，勿 JSON/坐标堆砌。
