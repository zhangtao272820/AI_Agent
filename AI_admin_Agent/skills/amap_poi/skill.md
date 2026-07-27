---
name: amap_poi
description: 高德 POI 搜索与周边查询
version: 1.0.0
stage: planning
owner: ai_admin_agent
---

## Planning

用户问「找餐厅/酒店/加油站」「附近有什么」「XX 周边咖啡」时：

| 场景 | 工具 | 参数 |
|------|------|------|
| 全城/市内搜店名、品牌、地标 | `search_places_amap(keywords, city?)` | city 可空，默认 ADMIN_AMAP_CITY |
| 以某地址为中心周边 | `search_nearby_amap(keywords, near_address, radius_m?)` | radius_m 默认 3000（米） |

示例话术 → 工具：
- 「天津站附近有什么咖啡馆」→ `search_nearby_amap("咖啡", "天津站")`
- 「国贸附近 500 米停车场」→ `search_nearby_amap("停车场", "北京国贸", 500)`
- 「搜一下星巴克」→ `search_places_amap("星巴克")`

需 `ADMIN_AMAP_KEY`。与路线可组合：先 `search_places_amap` 定地点，再 `get_travel_route` 算耗时。

## Reply

界面会展示地点列表/地图卡片；**文字回复由汇总模型撰写**：
- 先概括找到了什么（几家、大致区域），点出 1～2 个优选（最近、评分高、名称匹配度好）。
- 给 1 条实用建议（换关键词、缩小半径、或结合路线再问耗时）。
- 勿逐条复读卡片列表；80～180 字。
