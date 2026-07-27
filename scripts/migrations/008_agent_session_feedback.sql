-- 跨 Agent 会话级用户反馈（持久化，供进化 / 门控学习）
CREATE TABLE IF NOT EXISTS agent_session_feedback (
  id BIGSERIAL PRIMARY KEY,
  agent VARCHAR(16) NOT NULL CHECK (agent IN ('manager', 'db', 'rag', 'admin')),
  session_id VARCHAR(120) NOT NULL,
  feedback_key VARCHAR(120) NOT NULL,
  turn_id INTEGER,
  user_message_index INTEGER,
  run_id VARCHAR(80),
  score SMALLINT NOT NULL,
  question TEXT,
  comment TEXT,
  artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent, session_id, feedback_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_session_feedback_session
  ON agent_session_feedback (agent, session_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_session_feedback_turn
  ON agent_session_feedback (agent, session_id, turn_id)
  WHERE turn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_session_feedback_user_idx
  ON agent_session_feedback (agent, session_id, user_message_index)
  WHERE user_message_index IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_session_feedback_run
  ON agent_session_feedback (agent, run_id)
  WHERE run_id IS NOT NULL;
