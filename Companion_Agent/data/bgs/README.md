# 场景背景（VN 全 bleed）

放在本目录，由 `/api/bgs/{name}` 提供。

## 现有

title · campus · cafe · office · room · home · library · rain · store · forest · starry · festival  
+ P1：atelier · rooftop · greenhouse · bookstore · dance_studio（2026-07-18）  
+ **季节 P0**：`campus_winter` · `home_winter` · `cafe_winter` · `rain_winter`（2026-07-24）

`resolve_scene(..., season="winter")` 会优先选 `{stem}_winter.png`。

## P1 精修（已落地）

| 文件名 | 用途 | 状态 |
|--------|------|------|
| `atelier.png` | 苏晚悠画室 | ready · `scenes.json` |
| `rooftop.png` | 天台夜 | ready |
| `greenhouse.png` | 花艺温室 | ready |
| `bookstore.png` | 坡上书店 | ready |
| `dance_studio.png` | 练舞室 | ready |

## 季节 P0

| 文件名 | 用途 |
|--------|------|
| `campus_winter.png` | 校园冬 |
| `home_winter.png` | 居家冬 |
| `cafe_winter.png` | 咖啡店冬 |
| `rain_winter.png` | 冬街 / 雨街冬 |

生成规范：Cursor **GenerateImage**，16:9、纯环境、无文字 UI、无角色。

详见 [`../doc/开局结局演出与场景音乐.md`](../doc/开局结局演出与场景音乐.md)。
