// src/ai.worker.ts
import { pickAiMove, GameState } from "./ai";

// Messages FROM main thread
type InMsg =
  | { type: "COMPUTE"; gs: GameState; token: number };

// Messages TO main thread
type OutMsg =
  | { type: "RESULT"; gs: GameState; token: number }
  | { type: "ERROR"; message: string; token: number };

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;

  if (msg.type !== "COMPUTE") return;

  try {
    const next = pickAiMove(msg.gs);
    const out: OutMsg = { type: "RESULT", gs: next, token: msg.token };
    (self as any).postMessage(out);
  } catch (err: any) {
    const out: OutMsg = {
      type: "ERROR",
      message: err?.message ?? String(err),
      token: msg.token,
    };
    (self as any).postMessage(out);
  }
};
