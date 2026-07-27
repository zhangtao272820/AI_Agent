# android-automation Skill（OpenClaw 类 · P2-C3）

> Android 设备自动化：经 ADB shell 或 Android MCP sidecar 操作手机 App

## 何时加载

- `task_kind` 为 `mobile_app`
- 用户任务含：Android、安卓、手机、ADB、打开微信/支付宝、点击屏幕
- 无 `start_url` 或 URL 非 http(s)

## 环境

| 变量 | 说明 |
|------|------|
| `LOBSTER_ANDROID_MCP_ENABLED=1` | 启用 mobile 引擎 |
| `LOBSTER_ANDROID_MCP_SERVERS` | JSON MCP 配置（可选；无则 ADB 演示模式） |
| `LOBSTER_ANDROID_ADB_PATH` | adb 可执行路径，默认 `adb` |
| `LOBSTER_ANDROID_DEVICE_SERIAL` | 多设备时指定 serial |

需至少一台 `adb devices` 状态为 `device` 的已连接设备。

## 执行规则

1. 先 `adb devices` 确认设备在线
2. 打开 App：`am start` 或 MCP 工具；输入用 `input text`；点击用 `input tap x y`
3. 截图验证：`screencap -p` 或 MCP 截图工具
4. 卸载/恢复出厂/支付等高风险：说明风险并 finish 中止
5. 无法定位控件时：尝试 `uiautomator dump` 或 MCP UI 树

## 完成标准

- 打开 App：目标 Activity 前台或 finish 回报包名
- 输入/点击：finish 中说明操作与可见反馈
- 截图任务：finish 中确认已截图或描述屏幕内容

## 禁止

- 无确认执行卸载、恢复出厂、转账
- 编造未执行过的设备操作结果
