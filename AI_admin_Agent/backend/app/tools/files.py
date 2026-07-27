from __future__ import annotations

import os
import shutil

from app.core.config import settings
from app.tools.common import _tool_err, _tool_ok

def _get_safe_path(filename: str) -> str:
    """确保文件路径在安全的工作区内"""
    os.makedirs(settings.WORKSPACE_DIR, exist_ok=True)
    # 只取文件名，防止使用 ../ 逃逸到其他目录
    safe_name = os.path.basename(filename)
    return os.path.join(settings.WORKSPACE_DIR, safe_name)

def list_files(directory: str = "") -> str:
    """仅列出工作区内的文件"""
    os.makedirs(settings.WORKSPACE_DIR, exist_ok=True)
    try:
        files = os.listdir(settings.WORKSPACE_DIR)
        if not files:
            return _tool_ok(
                "工作区目前为空。",
                data={"workspace_dir": settings.WORKSPACE_DIR, "files": [], "count": 0},
                code="empty",
            )
        shown = files[:20]
        return _tool_ok(
            f"工作区 ({settings.WORKSPACE_DIR}) 下的文件:\n" + "\n".join(shown),
            data={"workspace_dir": settings.WORKSPACE_DIR, "files": shown, "count": len(shown)},
        )
    except Exception as e:
        return _tool_err(
            f"无法读取工作区目录: {str(e)}",
            data={"workspace_dir": settings.WORKSPACE_DIR},
            code="list_files_failed",
        )

def read_file_content(file_path: str) -> str:
    """仅读取工作区内的文件"""
    safe_path = _get_safe_path(file_path)
    try:
        with open(safe_path, 'r', encoding='utf-8') as f:
            return f.read(1000) # 只读前1000字符
    except Exception as e:
        return f"读取文件 {os.path.basename(file_path)} 失败: {str(e)}"

def write_file(file_path: str, content: str) -> str:
    """仅写入到工作区"""
    safe_path = _get_safe_path(file_path)
    try:
        with open(safe_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return _tool_ok(
            f"已成功将内容写入工作区文件: {os.path.basename(file_path)}",
            data={
                "file_path": os.path.basename(file_path),
                "safe_path": safe_path,
                "content_length": len(content or ""),
            },
        )
    except Exception as e:
        return _tool_err(
            f"写入文件 {os.path.basename(file_path)} 失败: {str(e)}",
            data={"file_path": os.path.basename(file_path), "safe_path": safe_path},
            code="write_failed",
        )

def move_file(src_path: str, dst_path: str) -> str:
    """仅在工作区内移动/重命名文件"""
    safe_src_path = _get_safe_path(src_path)
    safe_dst_path = _get_safe_path(dst_path)
    try:
        import shutil
        shutil.move(safe_src_path, safe_dst_path)
        return _tool_ok(
            f"已将工作区文件从 {os.path.basename(src_path)} 重命名/移动到 {os.path.basename(dst_path)}",
            data={
                "src_file": os.path.basename(src_path),
                "dst_file": os.path.basename(dst_path),
                "safe_src_path": safe_src_path,
                "safe_dst_path": safe_dst_path,
            },
        )
    except Exception as e:
        return _tool_err(
            f"移动文件失败: {str(e)}",
            data={
                "src_file": os.path.basename(src_path),
                "dst_file": os.path.basename(dst_path),
                "safe_src_path": safe_src_path,
                "safe_dst_path": safe_dst_path,
            },
            code="move_failed",
        )

def create_directory(dirname: str) -> str:
    """在工作区内创建文件夹"""
    safe_name = os.path.basename(dirname)
    dir_path = os.path.join(settings.WORKSPACE_DIR, safe_name)
    try:
        os.makedirs(dir_path, exist_ok=True)
        return _tool_ok(
            f"已在工作区创建目录: {safe_name}",
            data={"directory": safe_name, "safe_path": dir_path},
        )
    except Exception as e:
        return _tool_err(
            f"创建目录失败: {str(e)}",
            data={"directory": safe_name, "safe_path": dir_path},
            code="mkdir_failed",
        )

