import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktop } from "@/lib/modelport";

type Props = { dirty: boolean; busy: boolean; message: string; onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void; onError: (message: string) => void };
const canDiscard = ({ dirty, busy, message }: Pick<Props, "dirty" | "busy" | "message">) => !busy && (!dirty || window.confirm(message));

export function useSettingsLeaveGuard({ dirty, busy, message, onRegisterLeaveGuard, onError }: Props) {
  const state = useRef({ dirty, busy, message }); state.current = { dirty, busy, message };
  useEffect(() => {
    onRegisterLeaveGuard?.(() => canDiscard(state.current));
    let disposed = false; let stopListening: (() => void) | undefined;
    if (isDesktop) void getCurrentWindow().onCloseRequested((event) => { if (!canDiscard(state.current)) event.preventDefault(); })
      .then((stop) => { if (disposed) stop(); else stopListening = stop; })
      .catch(() => { if (!disposed) onError("无法启用窗口关闭保护，请保存内容后再关闭软件。"); });
    return () => { disposed = true; stopListening?.(); onRegisterLeaveGuard?.(null); };
  }, [onRegisterLeaveGuard, onError]);
  return () => canDiscard(state.current);
}
