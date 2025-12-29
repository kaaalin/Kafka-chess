/// <reference lib="webworker" />

// IMPORTANT:
// This file must contain ONLY game logic — NO React, NO JSX.

// ---- Types (copy from App.tsx, unchanged) ----
type Color = "white" | "black";
type Level = "Easy" | "Medium" | "Hard" | "Master";

interface AIState {
  mode: "cpu" | "human";
  cpuPlays: Color;
  level: Level;
}

interface GameState {
  turn: Color;
  ai: AIState;
  winReason?: string | null;
  promotion?: any;
  // keep all other fields exactly as in App.tsx
}

// ---- IMPORT or PASTE PURE LOGIC ONLY ----
// Paste ONLY these functions from App.tsx:
// - pickAiMove
// - generateMoves
// - evaluate
// - minimax (or equivalent)
// - deepClone
// - performMove
//
// ⚠️ DO NOT paste rendering helpers or JSX-related code ⚠️

// ----------------------------------------
/// <reference lib="webworker" />

// ---- types (copied from App.tsx) ----
// type GameState, Move, Square, Piece, etc.


// ---- PURE AI ENGINE (copied) ----
function pickAiMove(gs: GameState): GameState {
  // unchanged
}

function generateMoves(...) { ... }
function evaluate(...) { ... }
function minimax(...) { ... }
function deepClone(...) { ... }
function performMove(...) { ... }


// ---- Worker bridge ----
self.onmessage = (e) => {
  const { id, gs } = e.data;
  const next = pickAiMove(gs);
  self.postMessage({ id, next });
};

self.onmessage = (e: MessageEvent) => {
  const { id, gs } = e.data as { id: number; gs: GameState };

  // Safety check
  if (!gs || gs.ai.level !== "Master") {
    self.postMessage({ id, next: gs });
    return;
  }

  const next = pickAiMove(gs);
  self.postMessage({ id, next });
};
