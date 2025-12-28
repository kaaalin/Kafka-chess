import { pickAiMove } from "./engine";
import type { GameState } from "./engine";

type InMsg = { type: "THINK"; id: number; gs: GameState };
type OutMsg =
  | { type: "RESULT"; id: number; gs: GameState }
  | { type: "ERROR"; id: number; error: string };

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (!msg || msg.type !== "THINK") return;

  try {
    const next = pickAiMove(msg.gs);
    (self as any).postMessage({ type: "RESULT", id: msg.id, gs: next } satisfies OutMsg);
  } catch (err: any) {
    (self as any).postMessage({
      type: "ERROR",
      id: msg.id,
      error: String(err?.message ?? err),
    } satisfies OutMsg);
  }
};
