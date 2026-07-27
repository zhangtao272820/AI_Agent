---
name: travel_route
description: 国内出行路线与耗时
version: 1.0.0
stage: planning
owner: ai_admin_agent
compatible_agents:
  - AI_admin_Agent
---

## Planning

用户问「从 A 到 B 多久」「怎么去客户那里」「开会路上要多久」：
1. **必须**调用 `get_travel_route(origin, destination, mode)`，禁止凭记忆编造耗时。
2. 用户**未指定**出行方式时，使用 `compare_modes=true` 或 `mode=compare`，一次对比驾车 / 公交地铁 / 步行三种方案。
3. 用户明确说驾车/地铁/公交/步行/骑行时，只用对应 mode（driving / transit / walk / bike），不要对比。
4. 用户说「从这/这里/当前位置」出发时，使用规划上下文里的「用户当前位置」作为 origin；未共享定位则请用户说明起点或允许浏览器定位。
5. 若用户只说地点名、需先确认地址，可先用 `search_places_amap` 或 `resolve_address_amap`。
6. 问「附近吃什么再去开会」可组合 `search_nearby_amap` + `get_travel_route`。
7. 需 `ADMIN_AMAP_KEY`（高德 Web 服务 Key，个人开发者有免费日配额）。
8. 未配置 Key 时如实说明，勿编造路线。

## Reply

界面会展示路线/对比/地图卡片；**文字回复由汇总模型撰写**，与卡片互补：
- 先用 1～2 句直答（多久到、推荐哪种出行方式）。
- 必须给出 1～2 条实用建议（赶时间选驾车、早高峰优先地铁、天气好可步行等），依据工具数据，勿编造。
- 对比模式说明为何推荐「最快」方案；单一 mode 可概括总耗时与关键换乘，**不要逐步复述卡片里的分步导航**。
- 80～220 字，语气自然；数据来自工具，勿省略关键事实。
