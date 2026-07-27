import { defineEventHandler, readBody } from "h3";

// 运行追踪分享（可选功能）：当安装 langsmith 且配置 LANGCHAIN_API_KEY 后可用
export default defineEventHandler(async (event) => {
  const body = await readBody<{ run_id?: string }>(event);
  const runId = body?.run_id;

  if (!runId) {
    return Response.json({ error: "必须提供 run_id" }, { status: 400 });
  }

  try {
    const hasApiKey = Boolean(process.env.LANGCHAIN_API_KEY);
    if (!hasApiKey) {
      return Response.json(
        {
          error: "缺少 LANGCHAIN_API_KEY，无法分享运行记录",
          run_id: runId,
        },
        { status: 500 },
      );
    }

    let Client: any;
    try {
      const mod = await import("langsmith");
      Client = (mod as any).Client;
    } catch (_e) {
      return Response.json(
        {
          error: "未检测到 langsmith 依赖，请安装后使用：npm i langsmith",
          run_id: runId,
        },
        { status: 501 },
      );
    }

    const client = new Client({ webUrl: "https://smith.langchain.com" });
    const url = await client.shareRun(runId);
    return Response.json({ url }, { status: 200 });
  } catch (e: any) {
    return Response.json(
      { error: e?.message ?? "分享失败", run_id: runId },
      { status: 500 },
    );
  }
});
