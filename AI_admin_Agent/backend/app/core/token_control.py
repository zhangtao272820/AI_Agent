from app.core.config import settings
from typing import Dict

class TokenController:
    def __init__(self):
        # Session-based token tracking (in-memory for now)
        self.session_usage: Dict[str, int] = {}

    def check_limit(self, session_id: str, estimated_tokens: int) -> bool:
        """Check if the current request exceeds session or request limits."""
        # Request limit check
        if estimated_tokens > settings.MAX_TOKENS_PER_REQUEST:
            return False
        
        # Session limit check
        current_usage = self.session_usage.get(session_id, 0)
        if current_usage + estimated_tokens > settings.MAX_TOKENS_PER_SESSION:
            return False
            
        return True

    def update_usage(self, session_id: str, actual_tokens: int):
        """Update session usage with actual tokens consumed."""
        if session_id not in self.session_usage:
            self.session_usage[session_id] = 0
        self.session_usage[session_id] += actual_tokens

    def get_usage(self, session_id: str) -> int:
        return self.session_usage.get(session_id, 0)

token_controller = TokenController()
