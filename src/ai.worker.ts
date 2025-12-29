/// <reference lib="webworker" />

import { pickAiMove, type GameState } from "./engine";

self.onmessage = (e: MessageEvent) => {
  const { id, gs } = e.data as { id: number; gs: GameState };

  const next = pickAiMove(gs);
  self.postMessage({ id, next });
};
