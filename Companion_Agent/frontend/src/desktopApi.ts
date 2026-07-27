/** pywebview bridge (desktop exe only). Browser builds get no-ops. */

type DesktopBridge = {
  is_desktop?: () => Promise<boolean> | boolean;
  get_fullscreen?: () => Promise<boolean> | boolean;
  set_fullscreen?: (enabled: boolean) => Promise<boolean> | boolean;
  toggle_fullscreen?: () => Promise<boolean> | boolean;
};

declare global {
  interface Window {
    pywebview?: { api?: DesktopBridge };
  }
}

export function isDesktopShell(): boolean {
  return Boolean(window.pywebview?.api?.set_fullscreen);
}

export async function getDesktopFullscreen(): Promise<boolean | null> {
  const api = window.pywebview?.api;
  if (!api?.get_fullscreen) return null;
  try {
    return Boolean(await api.get_fullscreen());
  } catch {
    return null;
  }
}

export async function setDesktopFullscreen(enabled: boolean): Promise<boolean> {
  const api = window.pywebview?.api;
  if (!api?.set_fullscreen) return false;
  try {
    return Boolean(await api.set_fullscreen(enabled));
  } catch {
    return false;
  }
}
