import React, { useEffect, useRef, useState } from "react";

type FileLetter = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
type RankNum = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type Color = "white" | "black";
type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";
type SquareId = `${FileLetter}${RankNum}`;

const FILES: FileLetter[] = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS: RankNum[] = [1, 2, 3, 4, 5, 6, 7, 8];

const GLYPH: Record<PieceType, string> = {
  K: "\u265A\uFE0E", // ♚︎
  Q: "\u265B\uFE0E", // ♛︎
  R: "\u265C\uFE0E", // ♜︎
  B: "\u265D\uFE0E", // ♝︎
  N: "\u265E\uFE0E", // ♞︎
  P: "\u265F\uFE0E", // ♟︎
};

const pieceGlyph = (t: PieceType) => GLYPH[t];

const idFrom = (f: number, r: number): SquareId => `${FILES[f]}${r}` as SquareId;
const inBounds = (f: number, r: number) => f >= 0 && f < 8 && r >= 1 && r <= 8;

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

const INITIAL_COUNTS: Record<PieceType, number> = {
  K: 1,
  Q: 1,
  R: 2,
  B: 2,
  N: 2,
  P: 8,
};

const emptyStock = () => ({ ...INITIAL_COUNTS });
const zeroStock = () => ({ K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0 });

const woodColor = (f: number, r: number) => ((f + r) % 2 ? "#8C6B3E" : "#E6CBA8");

const shade = (hex: string, d: number) => {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const s = (x: number) => Math.max(0, Math.min(255, x + Math.round((255 * d) / 100)));
  r = s(r);
  g = s(g);
  b = s(b);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

const woodSquareBg = (f: number, r: number) => {
  const base = woodColor(f, r);
  return `linear-gradient(135deg, ${shade(base, 8)} 0%, ${base} 55%, ${shade(base, -6)} 100%)`;
};

// Encode a position for repetition tracking: board layout + side to move + king presence flags
function encodePosition(gs: GameState) {
  const cells = gs.board
    .map((sq) => {
      const o = sq.occupant;
      if (!o) return ".";
      if (o.kind === "metamorph") return o.color === "white" ? "M" : "m";
      const t = o.type;
      return o.color === "white" ? t : t.toLowerCase();
    })
    .join("");

  const turnChar = gs.turn === "white" ? "w" : "b";

  const wk = gs.board.some((sq) => {
    const o = sq.occupant;
    return o && o.kind === "piece" && o.type === "K" && o.color === "white";
  });

  const bk = gs.board.some((sq) => {
    const o = sq.occupant;
    return o && o.kind === "piece" && o.type === "K" && o.color === "black";
  });

  const kw = wk ? "1" : "0";
  const kb = bk ? "1" : "0";

  return `${turnChar}${kw}${kb}|${cells}`;
}

type Occupant =
  | { kind: "metamorph"; color: Color }
  | {
      kind: "piece";
      color: Color;
      type: PieceType;
      bornAtTurn: number;
      mustReturn?: boolean;
      returnByTurn?: number;
     coversBlueSymbol?: boolean;
    }
  | null;

interface Square {
  id: SquareId;
  file: number;
  rank: number;
  blueSymbol?: PieceType;
  occupant: Occupant;
}

interface ChrysalisStock {
  K: number;
  Q: number;
  R: number;
  B: number;
  N: number;
  P: number;
}

interface GameState {
  board: Square[];
  turn: Color;
  moveNumber: number;
  stock: { white: ChrysalisStock; black: ChrysalisStock };
  quietus: { white: ChrysalisStock; black: ChrysalisStock };
  kingOnBoard: { white: boolean; black: boolean };
  kingProtectedUntil: { white: number | null; black: number | null };
  selected: SquareId | null;
  promotion: { square: SquareId; color: Color } | null;
  message: string | null;
  winner: Color | null;
  winReason: string | null;
  ai: { mode: "human" | "cpu"; cpuPlays: Color; level: "Easy" | "Medium" | "Hard" };
  lastMove: { from: SquareId; to: SquareId; by: Color } | null;
  repetition: Record<string, number>;
}

function createInitialBoard(): Square[] {
  const board: Square[] = [];
  for (const r of RANKS) {
    for (let f = 0; f < 8; f++) {
      board.push({ id: idFrom(f, r), file: f, rank: r, occupant: null });
    }
  }

  // build bag of piece types for blue symbols (Metamorphia)
  const bag: PieceType[] = [];
  const pack = emptyStock();
  (Object.entries(pack) as [PieceType, number][]).forEach(([t, n]) => {
    for (let i = 0; i < n * 2; i++) bag.push(t);
  });

  // shuffle
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }

  // deal blue symbols in Metamorphia (ranks 3–6)
  let k = 0;
  for (let r = 3; r <= 6; r++) {
    for (let f = 0; f < 8; f++) {
      const s = board.find((sq) => sq.rank === r && sq.file === f)!;
      s.blueSymbol = bag[k++];
    }
  }

  // place metamorphs on ranks 1–2 (black) and 7–8 (white)
  for (const r of [1, 2] as RankNum[]) {
    for (let f = 0; f < 8; f++) {
      board.find((sq) => sq.rank === r && sq.file === f)!.occupant = {
        kind: "metamorph",
        color: "black",
      };
    }
  }
  for (const r of [7, 8] as RankNum[]) {
    for (let f = 0; f < 8; f++) {
      board.find((sq) => sq.rank === r && sq.file === f)!.occupant = {
        kind: "metamorph",
        color: "white",
      };
    }
  }

  return board;
}

function initialGame(): GameState {
  const base: GameState = {
    board: createInitialBoard(),
    turn: "white",
    moveNumber: 1,
    stock: { white: emptyStock(), black: emptyStock() },
    quietus: { white: zeroStock(), black: zeroStock() },
    kingOnBoard: { white: false, black: false },
    kingProtectedUntil: { white: null, black: null },
    selected: null,
    promotion: null,
    message: null,
    winner: null,
    winReason: null,
    ai: { mode: "cpu", cpuPlays: "black", level: "Hard" },
    lastMove: null,
    repetition: {},
  };

  const key = encodePosition(base);
  base.repetition = { [key]: 1 };

  return base;
}

function legalMovesForPiece(gs: GameState, from: Square): { f: number; r: number }[] {
  const occ = from.occupant as Extract<Occupant, { kind: "piece" }>;
  const color = occ.color;
  const board = gs.board;
  const moves: { f: number; r: number }[] = [];
  const f0 = from.file;
  const r0 = from.rank;
  const limit316 = !occ.mustReturn;

  const canLand = (nf: number, nr: number) => {
    if (!inBounds(nf, nr)) return false;
    if (limit316 && !(nr >= 3 && nr <= 6)) return false;
    const dest = board.find((s) => s.file === nf && s.rank === nr)!;
    if (!dest.occupant) return true;
    return dest.occupant.kind === "piece" && dest.occupant.color !== color;
  };

  const rays = (dirs: [number, number][]) => {
    for (const [df, dr] of dirs) {
      let nf = f0 + df;
      let nr = r0 + dr;
      while (inBounds(nf, nr)) {
        if (limit316 && !(nr >= 3 && nr <= 6)) break;
        const dest = board.find((s) => s.file === nf && s.rank === nr)!;
        const o = dest.occupant;
        if (!o) {
          moves.push({ f: nf, r: nr });
        } else {
          if (o.kind === "piece" && o.color !== color) moves.push({ f: nf, r: nr });
          break;
        }
        nf += df;
        nr += dr;
      }
    }
  };

  switch (occ.type) {
    case "N": {
      const deltas: [number, number][] = [
        [1, 2],
        [2, 1],
        [-1, 2],
        [-2, 1],
        [1, -2],
        [2, -1],
        [-1, -2],
        [-2, -1],
      ];
      for (const [df, dr] of deltas) {
        const nf = f0 + df;
        const nr = r0 + dr;
        if (canLand(nf, nr)) moves.push({ f: nf, r: nr });
      }
      break;
    }
    case "B":
      rays([
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]);
      break;
    case "R":
      rays([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]);
      break;
    case "Q":
      rays([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]);
      break;
    case "K": {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (!df && !dr) continue;
          const nf = f0 + df;
          const nr = r0 + dr;
          if (canLand(nf, nr)) moves.push({ f: nf, r: nr });
        }
      }
      break;
    }
    case "P": {
      const dir = color === "white" ? -1 : 1;
      const one = r0 + dir;
      if (inBounds(f0, one) && !gs.board.find((s) => s.file === f0 && s.rank === one)!.occupant) {
        moves.push({ f: f0, r: one });
      }
      for (const df of [-1, 1]) {
        const nf = f0 + df;
        const nr = r0 + dir;
        if (!inBounds(nf, nr)) continue;
        const o = gs.board.find((s) => s.file === nf && s.rank === nr)!.occupant;
        if (o && o.kind === "piece" && o.color !== color) {
          moves.push({ f: nf, r: nr });
        }
      }
      break;
    }
  }

  return moves;
}

function legalMovesForMetamorph(gs: GameState, from: Square): { f: number; r: number }[] {
  const m = from.occupant as Extract<Occupant, { kind: "metamorph" }>;
  const dir = m.color === "white" ? -1 : 1;
  const nr = from.rank + dir;
  if (!inBounds(from.file, nr)) return [];
  const dest = gs.board.find((s) => s.file === from.file && s.rank === nr)!;
  if (dest.occupant) return [];
  return [{ f: from.file, r: nr }];
}

function applyAutoTransforms(gs: GameState): { newGs: GameState; changed: boolean } {
  const next = deepClone(gs);
  let changed = false;

  for (const sq of next.board) {
    if (!(sq.rank >= 3 && sq.rank <= 6) || !sq.blueSymbol || !sq.occupant) continue;

    if (sq.occupant.kind === "metamorph") {
  const c = sq.occupant.color;
  const t = sq.blueSymbol;
  if (next.stock[c][t] > 0) {
    next.stock[c][t]--;
    sq.occupant = {
      kind: "piece",
      color: c,
      type: t,
      bornAtTurn: next.moveNumber,
      coversBlueSymbol: true, // NEW
    };
    if (t === "K") next.kingOnBoard[c] = true;
    changed = true;
  }
} else {
  const c = sq.occupant.color;
  const cur = sq.occupant.type;
  const t = sq.blueSymbol;
  if (cur !== t && next.stock[c][t] > 0) {
    next.stock[c][cur] = Math.min(INITIAL_COUNTS[cur], next.stock[c][cur] + 1);
    next.stock[c][t]--;
    sq.occupant = {
      kind: "piece",
      color: c,
      type: t,
      bornAtTurn: next.moveNumber,
      coversBlueSymbol: true, // NEW
    };
    if (cur === "K" && t !== "K") next.kingOnBoard[c] = false;
    if (t === "K") next.kingOnBoard[c] = true;
    changed = true;
  }
}
  }

  return { newGs: next, changed };
}

function isSquareAttacked(gs: GameState, f: number, r: number, by: Color) {
  return gs.board.some((sq) => {
    const o = sq.occupant;
    return (
      o &&
      o.kind === "piece" &&
      o.color === by &&
      legalMovesForPiece(gs, sq).some((m) => m.f === f && m.r === r)
    );
  });
}

function findKingSquare(gs: GameState, c: Color) {
  return (
    gs.board.find((sq) => {
      const o = sq.occupant;
      return o && o.kind === "piece" && o.color === c && o.type === "K";
    }) || null
  );
}

const anyPawnCanMove = (gs: GameState, c: Color) =>
  gs.board.some((sq) => {
    const o = sq.occupant;
    return o && o.kind === "piece" && o.color === c && o.type === "P" && legalMovesForPiece(gs, sq).length > 0;
  });

const anyMetamorphCanMove = (gs: GameState, c: Color) =>
  gs.board.some((sq) => {
    const o = sq.occupant;
    return o && o.kind === "metamorph" && o.color === c && legalMovesForMetamorph(gs, sq).length > 0;
  });

const hasAnyMetamorph = (gs: GameState, c: Color) =>
  gs.board.some((s) => s.occupant && s.occupant.kind === "metamorph" && s.occupant.color === c);

const hasAnyPawn = (gs: GameState, c: Color) =>
  gs.board.some((s) => s.occupant && s.occupant.kind === "piece" && s.occupant.color === c && s.occupant.type === "P");

const anyMoveAvailable = (gs: GameState, c: Color) =>
  gs.board.some((sq) => {
    const o = sq.occupant;
    if (!o || o.color !== c) return false;
    if (o.kind === "metamorph") return legalMovesForMetamorph(gs, sq).length > 0;
    if (o.kind === "piece") return legalMovesForPiece(gs, sq).length > 0;
    return false;
  });

function kingInCheck(gs: GameState, c: Color) {
  const ksq = findKingSquare(gs, c);
  if (!ksq) return false;
  const att: Color = c === "white" ? "black" : "white";
  return isSquareAttacked(gs, ksq.file, ksq.rank, att);
}

function stalemateOutcome(gs: GameState): { winner: Color | null; reason: string } | null {
  const side: Color = gs.turn;
  if (kingInCheck(gs, side)) return null;
  if (anyMoveAvailable(gs, side)) return null;

  const wk = !!findKingSquare(gs, "white");
  const bk = !!findKingSquare(gs, "black");

  if (wk && bk) {
    return { winner: null, reason: "stalemate (both players have kings)" };
  }

  if (!wk && !bk) {
    return null;
  }

  const winner: Color = wk ? "white" : "black";
  return { winner, reason: "stalemate vs kingless opponent" };
}

const activeCounts = (gs: GameState, c: Color) => {
  const m: Record<PieceType, number> = { K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0 };
  for (const sq of gs.board) {
    const o = sq.occupant;
    if (o && o.kind === "piece" && o.color === c) m[o.type]++;
  }
  return m;
};

const promotionAvailable = (gs: GameState, c: Color, t: PieceType) =>
  t !== "K" && t !== "P" && activeCounts(gs, c)[t] < INITIAL_COUNTS[t];

function applyPromotionChoice(state: GameState, type: PieceType) {
  if (!state.promotion) return state;
  if (type === "K" || type === "P") return state;

  const { square, color } = state.promotion;
  const next = deepClone(state);
  const sq = next.board.find((s) => s.id === square)!;

  if (!promotionAvailable(next, color, type)) return state;

  let taken = false;
  if (next.quietus[color][type] > 0) {
    next.quietus[color][type]--;
    taken = true;
  } else if (next.stock[color][type] > 0) {
    next.stock[color][type]--;
    taken = true;
  }

  if (!taken) {
    next.message = "No available piece in Quietus or Chrysalis for promotion.";
    return next;
  }

  const deadline = next.moveNumber + 1;
  sq.occupant = {
    kind: "piece",
    color,
    type,
    bornAtTurn: next.moveNumber,
    mustReturn: true,
    returnByTurn: deadline,
  };
  next.promotion = null;

  return applyAutoTransforms(next).newGs;
}

function detectWin(gs: GameState, lastMover: Color, capturedKing: Color | null) {
  if (capturedKing) return { winner: lastMover, reason: "king captured" };

  for (const c of ["white", "black"] as Color[]) {
    const hasKing = !!findKingSquare(gs, c);
    if (!hasKing) {
      const noP = !hasAnyPawn(gs, c);
      const pStuck = !noP && !anyPawnCanMove(gs, c);
      const noM = !hasAnyMetamorph(gs, c);
      const mStuck = !noM && !anyMetamorphCanMove(gs, c);
      if ((noP || pStuck) && (noM || mStuck)) {
        const winner: Color = c === "white" ? "black" : "white";
        return { winner, reason: "no king + no mobile pawns/metamorphs" };
      }
    }
  }

  return null;
}
function enforceReturnOrQuietus(gs: GameState): GameState {
  const next = deepClone(gs);
  let lostPieceDescription: string | null = null;

  for (const sq of next.board) {
    const occ = sq.occupant;
    if (
      occ &&
      occ.kind === "piece" &&
      occ.mustReturn &&
      typeof occ.returnByTurn === "number" &&
      next.moveNumber > occ.returnByTurn &&           // deadline passed
      !(sq.rank >= 3 && sq.rank <= 6)                 // still not in Metamorphia
    ) {
      // Send it to Quietus
      next.quietus[occ.color][occ.type]++;

      // Optional debug / user message
      const side = occ.color === "white" ? "White" : "Black";
      lostPieceDescription = `${side} ${GLYPH[occ.type]} failed to return and went to Quietus.`;

      sq.occupant = null;
    }
  }

  if (lostPieceDescription) {
    next.message = lostPieceDescription;
  }

  return next;
}

function performMove(gs: GameState, fromId: SquareId, toId: SquareId): GameState {
  if (gs.winner) return gs;

  // NEW: remember if each side had a king before this move
  const hadKingBefore: { white: boolean; black: boolean } = {
    white: !!findKingSquare(gs, "white"),
    black: !!findKingSquare(gs, "black"),
  };

  const sFrom = gs.board.find((s) => s.id === fromId)!;
  const sTo = gs.board.find((s) => s.id === toId)!;

  const mover = sFrom.occupant;
  if (!mover) return gs;

  const next = deepClone(gs);
  next.message = null;

  const from = next.board.find((s) => s.id === fromId)!;
  const to = next.board.find((s) => s.id === toId)!;

  let legal: { f: number; r: number }[] = [];

  if (mover.kind === "metamorph") {
    if (mover.color !== next.turn) return gs;

    const dir = mover.color === "white" ? -1 : 1;
    const expectedRank = sFrom.rank + dir;
    const attemptingStandardStep = sTo.file === sFrom.file && sTo.rank === expectedRank;

    if (attemptingStandardStep) {
      const hasActiveKingInMetamorphia = gs.board.some((sq) => {
        const o = sq.occupant;
        return (
          o &&
          o.kind === "piece" &&
          o.color === mover.color &&
          o.type === "K" &&
          sq.rank >= 3 &&
          sq.rank <= 6
        );
      });

      const isForbiddenKingCardTarget =
        !sTo.occupant && sTo.blueSymbol === "K" && sTo.rank >= 3 && sTo.rank <= 6;

      if (hasActiveKingInMetamorphia && isForbiddenKingCardTarget) {
        return {
          ...gs,
          message: "Illegal move: king blocked by a metamorph",
        };
      }
    }

    legal = legalMovesForMetamorph(gs, sFrom);
  } else {
    if (mover.color !== next.turn) return gs;
    legal = legalMovesForPiece(gs, sFrom);
  }

  if (!legal.some((m) => m.f === to.file && m.r === to.rank)) {
    return { ...gs, message: "Illegal move" };
  }

  // King-protection + "no-king-no-capture" rule before capture
let capturedKing: Color | null = null;
if (sTo.occupant && sTo.occupant.kind === "piece" && sTo.occupant.type === "K") {
  // NEW: attacker must have a king on the board to capture a king
  const attackerColor = (mover as any).color as Color;
  const attackerHasKing = !!findKingSquare(gs, attackerColor);
  if (!attackerHasKing) {
    return {
      ...gs,
      message: "Illegal move: you cannot capture a king while you have no king",
    };
  }

  // Existing one-turn king protection
  const target = sTo.occupant;
  const prot = gs.kingProtectedUntil[target.color];
  if (prot !== null && gs.moveNumber === prot) {
    return { ...gs, message: "That king is protected this turn." };
  }
}

  if (sTo.occupant && sTo.occupant.kind === "piece") {
    next.quietus[sTo.occupant.color][sTo.occupant.type]++;
    if (sTo.occupant.type === "K") {
      next.kingOnBoard[sTo.occupant.color] = false;
      capturedKing = sTo.occupant.color;
    }
  }

  // Actually move the piece
  to.occupant = from.occupant;
  from.occupant = null;

  next.lastMove = { from: fromId, to: toId, by: (mover as any).color };
  if (to.occupant && to.occupant.kind === "piece") {
    to.occupant.coversBlueSymbol = false;
  }
  if (
    to.occupant &&
    to.occupant.kind === "piece" &&
    to.occupant.mustReturn &&
    to.rank >= 3 &&
    to.rank <= 6
  ) {
    to.occupant.mustReturn = false;
    (to.occupant as any).returnByTurn = undefined;
  }
if (
  to.occupant &&
  to.occupant.kind === "piece" &&
  to.rank >= 3 &&
  to.rank <= 6 &&
  to.blueSymbol
) {
  const c = to.occupant.color;
  const cur = to.occupant.type;
  const t = to.blueSymbol;

  if (cur !== t && next.stock[c][t] > 0) {
    // Successful transform: change type and hide the blue symbol under the new piece
    next.stock[c][cur] = Math.min(INITIAL_COUNTS[cur], next.stock[c][cur] + 1);
    next.stock[c][t] = Math.max(0, next.stock[c][t] - 1);
    to.occupant.type = t;
    to.occupant.bornAtTurn = next.moveNumber;
    to.occupant.coversBlueSymbol = true;
  } else if (cur === t) {
    // NEW RULE: landing on a same-type card consumes/hides that symbol visually
    // (no stock change, no transform – just hide the blue symbol under this piece)
    to.occupant.coversBlueSymbol = true;
  }
  // Only remaining "no-transform" case is: cur !== t but no stock of t.
  // There we keep coversBlueSymbol = false so the symbol stays visible.
}

 
  // Pawn promotion: if a pawn just reached the last rank, open promotion panel
  if (
    to.occupant &&
    to.occupant.kind === "piece" &&
    to.occupant.type === "P" &&
    (to.rank === 1 || to.rank === 8)
  ) {
    next.promotion = { square: to.id, color: to.occupant.color };
  }


  
  // Update moves, clocks, turn, etc.
  next.moveNumber++;
  next.turn = next.turn === "white" ? "black" : "white";

  let { newGs } = applyAutoTransforms(next);

  // Enforce "return to Metamorphia next turn or go to Quietus"
  newGs = enforceReturnOrQuietus(newGs);

  // NEW: if a color just gained a king on this move, give it one-turn immunity
  for (const c of ["white", "black"] as Color[]) {
    const hadBefore = hadKingBefore[c];
    const hasNow = !!findKingSquare(newGs, c);
    
    // king appeared this move → protect it on opponent's upcoming turn
    if (!hadBefore && hasNow) {
      newGs.kingProtectedUntil[c] = newGs.moveNumber;
    }

    // optional: if a side has no king at all, clear any stale protection flag
    if (!hasNow) {
      newGs.kingProtectedUntil[c] = null;
    }
  }

  newGs.selected = null;
  // Don't blindly overwrite message if enforceReturnOrQuietus set one:
  // newGs.message = newGs.message ?? null;
  // or just leave message as-is unless you really want to clear it

// --- THREEFOLD REPETITION RULE ---
  // Encode the current position (board + side to move + king presence flags)
  const repKey = encodePosition(newGs);
  const repCount = (newGs.repetition[repKey] ?? 0) + 1;
  newGs.repetition[repKey] = repCount;

  if (repCount >= 3 && !newGs.winner) {
    const whiteHasKing = !!findKingSquare(newGs, "white");
    const blackHasKing = !!findKingSquare(newGs, "black");

    // 1) Draw when both players have kings OR both don't have
    if ((whiteHasKing && blackHasKing) || (!whiteHasKing && !blackHasKing)) {
      newGs.winner = null;
      newGs.winReason = "threefold repetition (draw)";
      newGs.message = "Draw by threefold repetition.";
      return newGs;
    }

    // 2) If only one has a king – a win for this player
    if (whiteHasKing !== blackHasKing) {
      const winner: Color = whiteHasKing ? "white" : "black";
      newGs.winner = winner;
      newGs.winReason = "threefold repetition vs kingless opponent";
      newGs.message = `Winner: ${winner} (threefold repetition vs kingless opponent)`;
      return newGs;
    }
  }
  // --- END THREEFOLD REPETITION RULE ---
  
  const lastMoverColor: Color = newGs.turn === "white" ? "black" : "white";

  const win = detectWin(newGs, lastMoverColor, capturedKing);
  if (win) {
    newGs.winner = win.winner;
    newGs.winReason = win.reason;
    newGs.message = `Winner: ${win.winner} (${win.reason})`;
  } else {
    const opponent: Color = newGs.turn;
    const ksq = findKingSquare(newGs, opponent);
    if (ksq) {
      const attackerHasKing = !!findKingSquare(newGs, lastMoverColor);
      const prot = newGs.kingProtectedUntil[opponent];
      const kingProtectedNow = prot !== null && newGs.moveNumber === prot;
      if (attackerHasKing && !kingProtectedNow) {
        const inCheck = isSquareAttacked(newGs, ksq.file, ksq.rank, lastMoverColor);
        if (inCheck) {
          newGs.message = `Check on ${opponent}!`;
        }
      }
    }
  }

  return newGs;
}


function aiResolvePromotion(state: GameState, color: Color) {
  for (const t of ["Q", "R", "B", "N"] as PieceType[]) {
    if (promotionAvailable(state, color, t)) return applyPromotionChoice(state, t);
  }
  return state;
}

function generateMoves(gs: GameState, c: Color) {
  const out: { from: SquareId; to: SquareId; next: GameState }[] = [];
  const base = deepClone(gs);
  base.turn = c;
  const startMoveNumber = base.moveNumber;

  for (const sq of base.board) {
    const o = sq.occupant;
    if (!o) continue;

    if (o.kind === "metamorph" && o.color === c) {
      const moves = legalMovesForMetamorph(base, sq);
      for (const m of moves) {
        const n = performMove(base, sq.id, idFrom(m.f, m.r));
        const n2 =
          n.promotion && n.promotion.color === c ? aiResolvePromotion(n, c) : n;
        // Ignore illegal/no-op moves (moveNumber doesn't advance), but keep winning/check moves.
        if (n2.moveNumber === startMoveNumber) continue;
        out.push({ from: sq.id, to: idFrom(m.f, m.r), next: n2 });
      }
    } else if (o.kind === "piece" && o.color === c) {
      const moves = legalMovesForPiece(base, sq);
      for (const m of moves) {
        const n = performMove(base, sq.id, idFrom(m.f, m.r));
        const n2 =
          n.promotion && n.promotion.color === c ? aiResolvePromotion(n, c) : n;
        if (n2.moveNumber === startMoveNumber) continue;
        out.push({ from: sq.id, to: idFrom(m.f, m.r), next: n2 });
      }
    }
  }

  return out;
}


function evaluate(gs: GameState, forC: Color) {
  if (gs.winner) return gs.winner === forC ? 1e9 : -1e9;

  const val: Record<PieceType, number> = {
    K: 5000,
    Q: 900,
    R: 500,
    B: 330,
    N: 320,
    P: 100,
  };

  let score = 0;

  for (const sq of gs.board) {
    const o = sq.occupant;
    if (o && o.kind === "piece") {
      const s = val[o.type];
      score += o.color === forC ? s : -s;
      if (sq.rank >= 3 && sq.rank <= 6) score += o.color === forC ? 4 : -4;
    }
  }

  const my = generateMoves(gs, forC).length;
  const op = generateMoves(gs, forC === "white" ? "black" : "white").length;

  return score + (my - op) * 0.5;
}

function pickAiMove(gs: GameState) {
  const { ai } = gs;
  const c = ai.cpuPlays;
  const moves = generateMoves(gs, c);
  if (!moves.length) return gs;

  if (ai.level === "Easy") {
    return moves[Math.floor(Math.random() * moves.length)].next;
  }

  if (ai.level === "Medium") {
    let b = -Infinity;
    let bn = moves[0].next;
    for (const m of moves) {
      const s = evaluate(m.next, c);
      if (s > b) {
        b = s;
        bn = m.next;
      }
    }
    return bn;
  }

  function minimax(
    st: GameState,
    d: number,
    a: number,
    b: number,
    max: boolean,
    maxC: Color
  ): number {
    if (!d || st.winner) return evaluate(st, maxC);

    const side: Color = max ? maxC : maxC === "white" ? "black" : "white";
    const list = generateMoves(st, side);

    if (!list.length) return evaluate(st, maxC);

    if (max) {
      let v = -Infinity;
      for (const mv of list) {
        v = Math.max(v, minimax(mv.next, d - 1, a, b, false, maxC));
        a = Math.max(a, v);
        if (b <= a) break;
      }
      return v;
    }

    let v = Infinity;
    for (const mv of list) {
      v = Math.min(v, minimax(mv.next, d - 1, a, b, true, maxC));
      b = Math.min(b, v);
      if (b <= a) break;
    }
    return v;
  }

  let best = -Infinity;
  let bn = moves[0].next;
  for (const mv of moves) {
    const sc = minimax(mv.next, 1, -Infinity, Infinity, false, c);
    if (sc > best) {
      best = sc;
      bn = mv.next;
    }
  }
  return bn;
}

function runSelfTests() {
  console.assert(inBounds(0, 1) && inBounds(7, 8) && !inBounds(-1, 5) && !inBounds(8, 3), "inBounds");

  const sh = shade("#808080", 10);
  console.assert(/^#[0-9a-fA-F]{6}$/.test(sh), "shade");

  const g = initialGame();
  console.assert(g.board.length === 64 && g.stock.white.P === 8 && g.stock.black.Q === 1, "initialGame");
  console.assert(
    g.board.filter((s) => s.rank >= 3 && s.rank <= 6 && s.blueSymbol).length === 32,
    "blue32"
  );

  (["K", "Q", "R", "B", "N", "P"] as PieceType[])
    .map((x: PieceType) => pieceGlyph(x))
    .forEach((ch: string) => {
      console.assert(typeof ch === "string" && ch.length > 0, "glyph");
    });

  const repKeys = Object.keys(g.repetition);
  console.assert(repKeys.length === 1 && g.repetition[repKeys[0]] === 1, "repetition init");

  const empty = initialGame();
  empty.board.forEach((sq) => {
    sq.occupant = null;
  });
  empty.kingOnBoard.white = false;
  empty.kingOnBoard.black = false;
  empty.turn = "white";
  const stal = stalemateOutcome(empty);
  console.assert(stal === null, "no stalemate when both players are kingless");

  const kTest = initialGame();
  kTest.board.forEach((sq) => {
    sq.occupant = null;
  });
  const a4 = kTest.board.find((sq) => sq.id === "a4");
  if (a4) {
    a4.occupant = { kind: "piece", color: "black", type: "K", bornAtTurn: 0 };
  }
  kTest.turn = "white";
  const res = detectWin(kTest, "black", null);
  console.assert(!!res && res!.winner === "black", "king detection when only black has king");
}

function ChrysalisGlyph({
  type,
  color,
}: {
  type: PieceType;
  color: Color;
}) {
  const isB = color === "black";
  const fill = isB ? "#111" : "#f7f7f7";
  const stroke = isB ? "#f0f0f0" : "#0a0a0a";
  const sw = isB ? 2.5 : 1.5;
  return (
    <div className="w-8 h-8 rounded-lg bg-neutral-800 border border-neutral-600 flex items-center justify-center shadow-sm">
      <svg viewBox="0 0 100 100" className="w-[90%] h-[90%]">
        <text
          x="50"
          y="78"
          textAnchor="middle"
          fontSize="92"
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          paintOrder="stroke"
          fontFamily="'Noto Chess','DejaVu Sans',serif"
        >
          {pieceGlyph(type)}
        </text>
      </svg>
    </div>
  );
}

function QuietusRow({
  label,
  color,
  counts,
  align,
}: {
  label: string;
  color: Color;
  counts: ChrysalisStock;
  align?: "left" | "right";
}) {
  const order: PieceType[] = ["K", "Q", "R", "B", "N", "P"];
  return (
    <div
      className={`flex ${align === "right" ? "justify-end" : "justify-start"} items-center gap-2 flex-wrap`}
    >
      <span className="text-sm mr-2 opacity-80 w-12">{label}</span>
      {order.flatMap((t) =>
        Array.from({ length: counts[t] }).map((_, i) => (
          <ChrysalisGlyph key={`${label}-${t}-${i}`} type={t} color={color} />
        ))
      )}
    </div>
  );
}

function StockView({
  stock,
  color,
  align
}: {
  stock: ChrysalisStock;
  color: Color;
  align?: "left" | "right";
}) {
  const order: PieceType[] = ["K", "Q", "R", "B", "N", "P"];
  return (
    <div className={`flex flex-col gap-3 ${align === "right" ? "items-end" : "items-start"}`}>
      {order.map((t) => (
        <div
          key={t}
          className={`flex gap-2 flex-wrap ${
            align === "right" ? "justify-end" : "justify-start"
          }`}
          aria-label={`${color} ${t} in chrysalis`}
        >
          {Array.from({ length: stock[t] }).map((_, i) => (
            <ChrysalisGlyph key={i} type={t} color={color} />
          ))}
        </div>
      ))}
    </div>
  );
}

const BlueSymbol = ({ type }: { type: PieceType }) => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    viewBox="0 0 100 100"
  >
    <text
      x="50"
      y="78"
      textAnchor="middle"
      fontSize="84"
      fill="none"
      stroke="#7DB1BF"
      strokeWidth="3"
      fontFamily="'Noto Chess','DejaVu Sans',serif"
    >
      {pieceGlyph(type)}
    </text>
  </svg>
);

const Piece = ({ occ }: { occ: Extract<Occupant, { kind: "piece" }> }) => {
  const color = occ.color === "white" ? "#f5f5f5" : "#1a1a1a";
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 2 }}
    >
      <div className="w-[80%] h-[80%] flex items-center justify-center" draggable>
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          style={{ filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.3))" }}
        >
          <text
            x="50"
            y="78"
            textAnchor="middle"
            fontSize="92"
            fill={color}
            stroke={color}
            strokeWidth="1"
            fontFamily="'Noto Chess','DejaVu Sans',serif"
          >
            {pieceGlyph(occ.type)}
          </text>
        </svg>
      </div>
    </div>
  );
};

const Metamorph = ({ color }: { color: Color }) => (
  <div
    className="absolute inset-0 flex items-center justify-center"
    style={{ zIndex: 1 }}
  >
    <div
      className="w-[72%] h-[72%] rounded-full border border-black/60"
      style={{
        background:
          color === "white"
            ? "radial-gradient(circle at 30% 30%, #ffffff, #d9d9d9)"
            : "radial-gradient(circle at 30% 30%, #444, #111)",
      }}
    />
  </div>
);

export default function App() {
  const [gs, setGs] = useState<GameState>(() => initialGame());
  const dragFrom = useRef<SquareId | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const testsOnce = useRef(false);
  const [showRules, setShowRules] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [coffeeImgFailed, setCoffeeImgFailed] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);
 const [isMobile, setIsMobile] = useState(() => {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768;
});

  const touchStartY = useRef<number | null>(null);
const touchMoved = useRef(false);

const handleRulesTouchStart = (e: React.TouchEvent) => {
  if (!isMobile) return;
  touchMoved.current = false;
  touchStartY.current = e.touches[0].clientY;
};

const handleRulesTouchMove = (e: React.TouchEvent) => {
  if (!isMobile) return;
  if (touchStartY.current == null) return;

  const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
  // if the finger moved more than ~10px, treat this as scroll, not a tap
  if (dy > 10) {
    touchMoved.current = true;
  }
};

const handleRulesTouchEnd = () => {
  if (!isMobile) return;
  // Only close if finger didn't move much (a real tap)
  if (!touchMoved.current) {
    setShowRules(false);
  }
};
  const newGame = () => setGs(initialGame());

  useEffect(() => {
  if (typeof navigator === "undefined") return;

  const ua = navigator.userAgent || "";
  const isiOS = /iPhone|iPad|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|Firefox/.test(ua);

  if (isiOS && isSafari) {
    setIsIosSafari(true);
    setCoffeeImgFailed(true); // force text mode there
  }
}, []);

  useEffect(() => {
    if (!testsOnce.current) {
      try {
        runSelfTests();
      } catch (e) {
        console.warn("Self-tests:", e);
      }
      testsOnce.current = true;
    }
  }, []);

  useEffect(() => {
    const check = () => {
      if (typeof window !== "undefined") {
        setIsMobile(window.innerWidth < 768);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (gs.winner || gs.ai.mode !== "cpu" || gs.turn !== gs.ai.cpuPlays) return;

    if (gs.promotion && gs.promotion.color === gs.ai.cpuPlays) {
      setGs((p) => applyPromotionChoice(p, aiBestPromotion(p, p.ai.cpuPlays)));
      return;
    }

    const id = window.setTimeout(() => setGs((p) => pickAiMove(p)), 150);
    return () => window.clearTimeout(id);
  }, [gs.turn, gs.ai.mode, gs.ai.cpuPlays, gs.ai.level, gs.promotion, gs.winner]);

  const aiBestPromotion = (st: GameState, c: Color): PieceType => {
    for (const t of ["Q", "R", "B", "N"] as PieceType[]) {
      if (promotionAvailable(st, c, t)) return t;
    }
    return "Q";
  };

  function prepareDragImage(e: React.DragEvent, occ: Exclude<Occupant, null>) {
    if (!dragGhostRef.current) {
      const host = document.createElement("div");
      host.style.position = "fixed";
      host.style.top = "-9999px";
      host.style.left = "-9999px";
      host.style.pointerEvents = "none";
      document.body.appendChild(host);
      dragGhostRef.current = host;
    }

    const host = dragGhostRef.current!;
    host.innerHTML = "";

    const ghost = document.createElement("div");
    ghost.style.width = "64px";
    ghost.style.height = "64px";
    ghost.style.display = "flex";
    ghost.style.alignItems = "center";
    ghost.style.justifyContent = "center";
    ghost.style.background = "transparent";

    if (occ.kind === "piece") {
      const c = occ.color === "white" ? "#f5f5f5" : "#1a1a1a";
      ghost.innerHTML = `<svg viewBox="0 0 100 100" width="64" height="64" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><text x="50" y="70" text-anchor="middle" font-size="92" fill="${c}" stroke="${c}" stroke-width="1" font-family="'Noto Chess','DejaVu Sans',serif">${
        GLYPH[(occ as Extract<Occupant, { kind: "piece" }>).type]
      }</text></svg>`;
    } else {
      const fill =
        occ.color === "white"
          ? "radial-gradient(circle at 30% 30%, #ffffff, #d9d9d9)"
          : "radial-gradient(circle at 30% 30%, #444, #111)";
      ghost.innerHTML = `<div style="width:56px;height:56px;border-radius:9999px;border:1px solid rgba(0,0,0,.6);background:${fill}"></div>`;
    }

    host.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 32, 32);
  }

  const onDragStart = (e: React.DragEvent, sq: Square) => {
    if (
      gs.winner ||
      (gs.ai.mode === "cpu" && gs.turn === gs.ai.cpuPlays) ||
      !sq.occupant ||
      sq.occupant.color !== gs.turn
    ) {
      e.preventDefault();
      return;
    }
    dragFrom.current = sq.id;
    e.dataTransfer.setData("text/plain", sq.id);
    prepareDragImage(e, sq.occupant as any);
  };

  const onDrop = (e: React.DragEvent, sq: Square) => {
    e.preventDefault();
    if (gs.ai.mode === "cpu" && gs.turn === gs.ai.cpuPlays) return;
    const fromId = dragFrom.current || (e.dataTransfer.getData("text/plain") as SquareId);
    if (!fromId) return;
    dragFrom.current = null;
    setGs((prev) => performMove(prev, fromId, sq.id));
  };

 const clickMove = (sq: Square) => {
  if (gs.winner || (gs.ai.mode === "cpu" && gs.turn === gs.ai.cpuPlays)) return;

  // Nothing selected yet → try to select a piece
  if (!gs.selected) {
    if (!sq.occupant || sq.occupant.color !== gs.turn) return;
    setGs({ ...gs, selected: sq.id });
    return;
  }

  // Second click on the same square → cancel selection
  if (gs.selected === sq.id) {
    setGs({ ...gs, selected: null, message: null }); // optional: clear message too
    return;
  }

  // Optional UX: clicking another of your own pieces changes the selection instead of moving
  if (sq.occupant && sq.occupant.color === gs.turn) {
    setGs({ ...gs, selected: sq.id });
    return;
  }

  // Otherwise, try to move from previously selected square to this square
  setGs(performMove(gs, gs.selected as SquareId, sq.id));
};


  const handlePromotion = (t: PieceType) => {
    if (!gs.promotion) return;
    if (t === "K" || t === "P") {
      setGs((g) => ({ ...g, message: "Pawns cannot promote to King or Pawn." }));
      return;
    }
    const { square, color } = gs.promotion;
    const next = deepClone(gs);
    const s = next.board.find((x) => x.id === square)!;

    if (!promotionAvailable(next, color, t)) {
      next.message = "You can't promote to that piece right now.";
      setGs(next);
      return;
    }

    let taken = false;
    if (next.quietus[color][t] > 0) {
      next.quietus[color][t]--;
      taken = true;
    } else if (next.stock[color][t] > 0) {
      next.stock[color][t]--;
      taken = true;
    }

    if (!taken) {
      next.message = "No available piece in Quietus or Chrysalis for promotion.";
      setGs(next);
      return;
    }

    const deadline = next.moveNumber + 1;
    s.occupant = {
      kind: "piece",
      color,
      type: t,
      bornAtTurn: next.moveNumber,
      mustReturn: true,
      returnByTurn: deadline,
    };
    next.promotion = null;

    setGs(applyAutoTransforms(next).newGs);
  };

  const whiteStock = gs.stock.white;
  const blackStock = gs.stock.black;

  const rankOrder = flipped ? [...RANKS].slice().reverse() : RANKS;
  const fileOrder = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
const isCpuThinking =
  gs.ai.mode === "cpu" &&
  gs.turn === gs.ai.cpuPlays &&
  !gs.winner;
  
  // MOBILE LAYOUT
  if (isMobile) {
    return (
      <div className="min-h-screen w-full bg-neutral-900 text-neutral-100 flex flex-col items-stretch p-3 sm:p-4 pb-24">
        {/* Top bar: Rules + yellow messages */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <button
            onClick={() => setShowRules(true)}
            className="text-[11px] sm:text-base font-semibold text-neutral-200 tracking-wide hover:text-white border border-neutral-600 rounded-full px-3 py-1 bg-neutral-800/80"
          >
            INFO
          </button>
  <a
  href="https://www.buymeacoffee.com/kalinyanev"
  className="inline-block border-[0.5px] bg-[#000000] border-white rounded-2xl px-2"
  target="_blank"
  rel="noreferrer"
>
  {/* Image for non-iOS Safari, with fallback */}
  {!coffeeImgFailed && !isIosSafari && (
    <img
      src="https://img.buymeacoffee.com/button-api/?text=Buy%20the%20authors%20a%20coffee&emoji=☕&slug=kalinyanev&button_colour=000000&font_colour=ffffff&font_family=Poppins&outline_colour=ffffff&coffee_colour=83b2be"
      className="block mx-auto"
      alt="Buy the authors a coffee"
      onError={() => setCoffeeImgFailed(true)}
    />
  )}

  {/* Text-only version on iOS Safari or if image fails */}
  {(coffeeImgFailed || isIosSafari) && (
   <span
  className="
    block sm:text-xs text-center font-Poppins
    px-3 py-2 rounded-2xl bg-[#000000] text-white font-bold text-[11px]
  "
>
  Buy the authors a coffee ☕
</span>
  )}
</a>


            <button
            onClick={newGame}
            className="px-3 py-2 rounded-2xl bg-neutral-200 text-neutral-900 font-semibold shadow text-[11px] sm:text-base"
          >
            New Game
          </button>
          <button
            onClick={() => setFlipped((f) => !f)}
            className="px-3 py-2 rounded-2xl bg-neutral-700 text-neutral-100 font-semibold shadow text-[11px] sm:text-base"
          >
            Flip Board
          </button>
      
         
        </div>
  {/* Row 2: message */}
        
        {/* Row 3: Computer opponent box */}
       <div className="flex justify-center mb-2">
  <div className="w-full p-2 rounded-xl bg-neutral-800/70 border border-neutral-700 space-y-1">
    <div className="flex items-center justify-between text-sm">
      <div className="font-semibold">Computer opponent</div>
      {isCpuThinking && (
        <div className="flex items-center gap-1 text-[10px] tracking-[0.18em] text-white">
          <img
            src="/cover-bmac.png"
            alt="CPU thinking"
            className="w-4 h-4 object-contain rounded-full shadow animate-pulse"
          />
          <span>thinking …</span>
        </div>
      )}
    </div>
    <label className="flex items-center justify-between gap-2 text-sm">

              <span>Mode</span>
              <select
                className="bg-neutral-900 border border-neutral-600 rounded px-2 py-1 text-sm"
                value={gs.ai.mode}
                onChange={(e) => setGs({ ...gs, ai: { ...gs.ai, mode: e.target.value as any } })}
              >
                <option value="human">Human vs Human</option>
                <option value="cpu">Human vs Computer</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Computer plays</span>
              <select
                className="bg-neutral-900 border border-neutral-600 rounded px-2 py-1 text-sm"
                value={gs.ai.cpuPlays}
                onChange={(e) => setGs({ ...gs, ai: { ...gs.ai, cpuPlays: e.target.value as Color } })}
              >
                <option value="white">White</option>
                <option value="black">Black</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Level</span>
              <select
                className="bg-neutral-900 border border-neutral-600 rounded px-2 py-1 text-sm"
                value={gs.ai.level}
                onChange={(e) => setGs({ ...gs, ai: { ...gs.ai, level: e.target.value as any } })}
              >
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
              </select>
            </label>
          </div>
        </div>

        {/* Row 4: Board */}
        <div className="flex justify-center mt-0">
          <div
            className="grid grid-cols-8 select-none rounded-xl overflow-hidden shadow-2xl w-full"
            style={{ border: "4px solid #3b2f2f" }}
          >
            {rankOrder.map((r) =>
              fileOrder.map((f) => {
                const sq = gs.board.find((s) => s.file === f && s.rank === r)!;
                const isSel = gs.selected === sq.id;
                const lm = gs.lastMove;
                const showAi = gs.ai.mode === "cpu" && lm && lm.by === gs.ai.cpuPlays;
                const isFrom = showAi && lm!.from === sq.id;
                const isTo = showAi && lm!.to === sq.id;
const occ = sq.occupant;
const hidesBlue =
  !!occ && occ.kind === "piece" && occ.coversBlueSymbol === true;
                return (
                  <div
                    key={sq.id}
                    onClick={() => clickMove(sq)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDrop(e, sq)}
                    className={`relative aspect-square ${
                      isSel ? "outline outline-4 outline-emerald-400/80" : ""
                    }`}
                 style={{ background: woodSquareBg(f, r) }}
                  >
                    {isFrom && (
                      <div className="absolute inset-1 rounded-lg ring-4 ring-yellow-400/70 pointer-events-none" />
                    )}
                    {isTo && (
                      <div className="absolute inset-1 rounded-lg ring-4 ring-green-400/70 pointer-events-none" />
                    )}


{sq.blueSymbol && r >= 3 && r <= 6 && !hidesBlue && (
  <BlueSymbol type={sq.blueSymbol} />
)}

                    {sq.occupant?.kind === "metamorph" && (
                      <div draggable onDragStart={(e) => onDragStart(e, sq)}>
                        <Metamorph color={sq.occupant.color} />
                      </div>
                    )}

                    {sq.occupant?.kind === "piece" && (
                      <div draggable onDragStart={(e) => onDragStart(e, sq)}>
                        <Piece occ={sq.occupant} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
         {/* Fixed message bar under the board */}
<div className="flex justify-center mt-2">
  <div className="w-full max-w-[min(90vw,40rem)]">
    <button
      className={`w-full px-3 py-2 rounded-2xl text-[11px] sm:text-xs text-center border
        ${
          gs.message
            ? "bg-[#83b2be] text-black border-neutral-700"
            : "bg-neutral-800 text-neutral-300 border-neutral-700"
        }`}
      disabled
    >
<div className="w-full text-center text-[11px] sm:text-xs">
  {gs.message ? (
    <>
      {gs.message} ({gs.turn})
    </>
  ) : (
    <>
      Turn: <b className="capitalize">{gs.turn}</b>
    </>
  )}
</div>
    </button>
  </div>
</div>
        {/* Row 5: Two chrysalises side by side */}
      <div className="mt-4 flex flex-row gap-4 justify-center">
        <div className="flex-1 min-w-[120px] max-w-xs justify-left">
          <h2 className="text-sm font-semibold mb-1 text-center">White chrysalis</h2>
          {/* Smaller pieces on mobile via scale */}
          <div className="scale-[0.75] origin-top">
            <StockView stock={whiteStock} color="white" />
          </div>
        </div>

        <div className="flex-1 min-w-[120px] max-w-xs justify-right">
          <h2 className="text-sm font-semibold mb-1 text-center">Black chrysalis</h2>
          {/* Smaller pieces on mobile via scale */}
          <div className="scale-[0.75] origin-top">
            <StockView stock={blackStock} color="black" align="right" />
          </div>
        </div>
      </div>

        {/* Quietus – mobile only, fixed at bottom */}
        <div className="mt-1 left-3 right-3 bottom-3 bg-neutral-800/95 backdrop-blur border border-neutral-700 rounded-2xl p-3 shadow-xl z-30">
          <div className="flex items-center justify-between">
            <div className="font-semibold tracking-wide text-[14px]">Quietus</div>
            <div className="text-[11px] sm:text-xs opacity-70 text-right">
              Captured pieces
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="scale-75 origin-top">
            <QuietusRow label="White" color="white" align="left" counts={gs.quietus.white}/>
            </div>
            <div className="scale-75 origin-top">
            <QuietusRow label="Black" color="black" align="right" counts={gs.quietus.black}/>
            </div>
          </div>
        </div>


        {/* Rules modal */}
       
  {showRules && (
  <div
    className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
    onClick={() => {
      // Backdrop click closes only on desktop/tablet
      if (!isMobile) setShowRules(false);
    }}
  >
    <div
      className="max-h-[85vh] w-full max-w-3xl overflow-auto"
      // Desktop: prevent backdrop click when clicking inside
      onClick={(e) => {
        if (!isMobile) e.stopPropagation();
      }}
      // Mobile: detect tap vs scroll
      onTouchStart={handleRulesTouchStart}
      onTouchMove={handleRulesTouchMove}
      onTouchEnd={handleRulesTouchEnd}
    >
             <div className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl p-6">
              <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
                Kafka Chess - Rules &amp; Information
              </h2>
              <p className="mb-4 opacity-90">
                This chess variant was developed by <strong>Kalin Yanev</strong> and his son, <strong>Ivaylo
                Yanev</strong>, in 2024, in Sofia, Bulgaria. They were not aware of chess variants prior to that; the
                game appeared as a result of sporadic contemplation assisted by a physical prototype (taken out in early afternoons).
              </p>
<img
  src="https://kafkachess.com/authors.JPG"
  alt="Authors Kalin and Ivaylo Yanev"
  className="w-full rounded-xl mb-4 border border-neutral-700"
/>
              <h3 className="text-xl font-semibold mt-4 mb-2">Setup</h3>
              <ul className="list-disc pl-6 space-y-1 opacity-90">
                <li>
                  <strong>Board:</strong> 8×8 classical.
                </li>
                <li>
                  <strong>Ranks 1-2 and 7-8:</strong> filled with metamorphs (round tokens).
                </li>
                <li>
                  <strong>Ranks 3-6 - 'Metamorphia':</strong> every square displays a piece card - a shuffled layout of
                  all 32 classical chess pieces (no color division), one per square.
                </li>
                <li>
                  <strong>Chrysalis (outside the board):</strong> available piece supply (limited to starting counts of
                  the classical 16 per color/player) - drawn to transform when stepping on a piece card in Metamorphia (ranks
                  3-6); and restored back there when that piece changes type into another.
                </li>
                <li>
                  <strong>Quietus (outside the board):</strong> permanent graveyard of captured pieces; also the first
                  source for promotion choices.
                </li>
              </ul>

              <h3 className="text-xl font-semibold mt-4 mb-2">Pieces</h3>
              <ul className="list-disc pl-6 space-y-2 opacity-90">
                <li>
                  <strong>Metamorphs</strong> (16 per player): Move 1 square vertically toward the center;
                  no captures, no jumping, not capturable. On landing in Metamorphia (ranks 3-6) they transform into
                  that square’s piece card if available in the player's Chrysalis, and permanently disappear; otherwise, they remain
                  metamorphs and may keep moving vertically later. Could move on any rank, but not promotable if they
                  reach the last rank.
                </li>
                <li>
                  <strong>Rooks / Bishops / Queen / Knight:</strong> Standard chess movement, but confined to Metamorphia (ranks 3-6).
                </li>
                <li>
                  <strong>King:</strong> Standard chess movement, but confined to Metamorphia. *King safety: a king is
                  immune to capturing on the opponent’s immediate next turn after it appears on the board; an enemy king
                  can't be captured unless one's own king is on the board.
                </li>
                <li>
                  <strong>Pawns:</strong> Standard chess movement and capture. The only pieces except metamorphs allowed
                  to progress outside Metamorphia (outside ranks 3-6). On reaching the last rank they promote to any available
                  piece other than the King (taken from Quietus first, else Chrysalis). The promoted piece must return
                  to ranks 3–6 according to its classical movement next turn or it goes to Quietus.
                </li>
              </ul>

              <h3 className="text-xl font-semibold mt-4 mb-2">Rules</h3>
              <ul className="list-disc pl-6 space-y-2 opacity-90">
                <li>
                  <strong>Setting up and starting:</strong> Metamorphs are put on the board. Pieces are ordered in each
                  player's Chrysalis. The 32 piece cards are shuffled and - if in a physical game setting - dealt by the white player on Metamorphia's
                  ranks 3–6 (order: a6 → h6, a5 → h5, a4 → h4, a3 → h3). White moves first.
                </li>
                <li>
                  <strong>Metamorphia interactions:</strong> Landing on a piece card instantly transforms the unit into
                  that piece only if your Chrysalis has one available; otherwise, it stays as-is and will auto-transform
                  later if it remains on that square and needed stock appears.
                </li>
                <li>
                  <strong>Special rule for not blocking king piece cards by a metamorph:</strong> If a player has an
                  active king piece in the Metamorphia, it is forbidden for its metamorphs to step on an unoccupied king
                  piece card. Such a move is illegal and will be rejected.
                </li>
                <li>
                  <strong>Board restrictions:</strong> All real pieces must stay on ranks 3-6; only pawns may enter
                  outside. Metamorphs move only one square vertically toward the center and never capture or jump.
                </li>
                <li>
                  <strong>Chrysalis (piece supply):</strong> Limited to starting counts (K-1, Q-1, R-2, B-2, N-2, P-8).
                  When a unit transforms, the new piece is taken from the Chrysalis and the previous piece type is
                  returned back to the Chrysalis.
                </li>
                <li>
                  <strong>Quietus (captures):</strong> Captured pieces go here permanently. Promotion takes the chosen
                  piece from Quietus first, otherwise from Chrysalis.
                </li>
                <li>
                  <strong>Promotion rule:</strong> On reaching the last rank, a pawn promotes to any available piece in
                  Quietus or Chrysalis oher than King. The promoted piece must return to Metamorphia (ranks 3-6) on its very next turn or it goes to
                  Quietus. If both player's Chrysalis and Quietus are empty, the pawn does not transform; since it can't return to Metamorphia, on the next turn it is taken to Quietus.
                </li>
                <li>
                  <strong>Edge metamorph rule:</strong> Moving a metamorph 1 → 2 or 8 → 7 does not transform it.
                </li>
                <li>
                  <strong>King safety and capture:</strong> A king is immune to capture on the opponent’s immediate next
                  turn after it appears. You cannot capture the enemy king if your own king is not on the board.
                </li>
              </ul>

              <h3 className="text-xl font-semibold mt-4 mb-2">Victory conditions</h3>
              <ol className="list-decimal pl-6 space-y-1 opacity-90">
                <li>Capturing the king.</li>
                <li>
                  Opponent has no king and (no pawns or all pawns immobile) and (no metamorphs or all metamorphs
                  immobile).
                </li>
                <li>
                Metamorphic stalemate (a sole king is blocked by opposite metamorphs and/or own pieces which are blocked by opposite metamorphs) while the opposite player is kingless.
                </li>
                <li>
                  Threefold repetition when the opponent is kingless (the side with a king wins).
                </li>
                <li>50-move rule when the opponent is kingless. (The metamorphs have the same status as pawns regarding the rule - any move by a metamorph resents the count.)</li>
              </ol>

              <h3 className="text-xl font-semibold mt-4 mb-2">Draw conditions</h3>
              <ol className="list-decimal pl-6 space-y-1 opacity-90">
                <li>Metamorphic stalemate (both opponents are kingful, one of the kings is blocked by opposite metamorphs and/or by own pieces which are blocked by opposite metamorphs). </li>
                <li>
                  Threefold repetition when both players are either kingless, or both have kings.
                </li>
                <li>50-move rule when both players are either kingless, or kingful.</li>
                <li>Mutual agreement.</li>
              </ol>

              <p className="mt-4 opacity-90">
                <em>Classical exceptions:</em> 1). No castling,  2) no en passant, 3)  no checkmate (since taking the king - and hence moving into check - is allowed, 4) no classical chess stalemate (same reason) - a metamorphic stalemate instead, explained above.
              </p>
                     <p className="mt-4 opacity-90">
                *Special thanks to Theodore De Marville for his sharp and quick critical thinking, and H.G.Muller who dialectically  helped refining some end game rules - especially winning by three-fold repetition.
               </p>
              <p className="mt-4 text-sm opacity-70">
                Feedback: <a className="underline" href="mailto:kalinyanev@yahoo.com">kalinyanev@yahoo.com</a>
              </p>
            </div>
          </div>
        </div>
      )}

      
        {/* Promotion modal */}
        {gs.promotion && (
          <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center">
            <div className="bg-neutral-900 border border-neutral-700 p-4 rounded-xl w-[90%] max-w-[420px]">
              <div className="text-lg font-semibold mb-2">Promote pawn</div>
              <div className="grid grid-cols-4 gap-2">
  {(["Q", "R", "B", "N"] as PieceType[]).map((t) => (
    <button
      key={t}
      className="p-3 rounded-xl bg-white text-neutral-900 disabled:opacity-40"
      disabled={!promotionAvailable(gs, gs.promotion!.color, t)}
      onClick={() => handlePromotion(t)}
    >
      <span
        className="text-3xl leading-none "
        style={{
          fontFamily: "'Noto Chess','DejaVu Sans',serif",
          // white side promotes → light piece, black side → dark piece
          color:
            gs.promotion?.color === "white"
              ? "#ffffff" 
              : "#111111", 
              backgroundColor:
            gs.promotion?.color === "white"
        ? "#000000"  
        : "#ffffff", 
        }}
      >
        {pieceGlyph(t)}
      </span>
    </button>
  ))}

              </div>
              <div className="mt-3 text-sm opacity-80">
                Promote only to Q, R, B, or N. If available in Quietus, it will be taken from there first.
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // DESKTOP LAYOUT (old view)
return (
  <div className="min-h-screen w-full flex items-start justify-center gap-4 bg-neutral-900 p-4 pl-48 text-neutral-100">
    {/* Left gutter: BuyMeACoffee + rules, in the space between edge and board */}
<div className="fixed top-3 left-4 z-50 flex flex-col gap-1 items-start w-64">
  {/* Buy Me a Coffee button */}
  <a href="https://www.buymeacoffee.com/kalinyanev" target="_blank">
    <img
      src="https://img.buymeacoffee.com/button-api/?text=Buy%20the%20authors%20a%20coffee&emoji=☕&slug=kalinyanev&button_colour=171717&font_colour=83b2be&font_family=Poppins&outline_colour=ffffff&coffee_colour=83b2be"
      className="block w-full h-auto"
    />
  </a>

  {/* Rules button */}
  <button
    onClick={() => setShowRules(true)}
    className="text-sm font-semibold text-neutral-300 tracking-wide hover:text-neutral-200"
  >
    rules + info
  </button>
</div>
      {/* Left panel: white chrysalis + controls */}
      <div className="flex flex-col gap-3 w-56 shrink-0">
        <h2 className="text-lg font-semibold">White chrysalis</h2>
        <StockView stock={whiteStock} color="white" />
        <div className="mt-2 flex gap-2">
          <button
            onClick={newGame}
            className="px-3 py-2 rounded-2xl bg-neutral-200 text-neutral-900 font-semibold shadow"
          >
            New Game
          </button>
          <button
            onClick={() => setFlipped((f) => !f)}
            className="px-3 py-2 rounded-2xl bg-neutral-700 text-neutral-100 font-semibold shadow"
          >
            Flip Board
          </button>
        </div>
        <div className="text-sm opacity-80">
          Turn: <span className="font-bold capitalize">{gs.turn}</span>
        </div>
        {gs.message && (
          <div className="text-xs bg-yellow-500/20 text-yellow-200 px-2 py-1 rounded border border-yellow-500/50">
            {gs.message}
          </div>
        )}
        <div className="w-full p-3 rounded-xl bg-neutral-800/70 border border-neutral-700 space-y-2">
  <div className="flex items-center justify-between text-sm">
    <div className="font-semibold">Computer opponent</div>
    {isCpuThinking && (
      <div className="flex items-center text-[10px] tracking-[0.18em] text-white">
        <img
          src="/cover-bmac.png"
          alt="CPU thinking"
          className="w-4 h-4 object-contain rounded-full shadow animate-pulse"
        />
        <span>thinking…</span>
      </div>
    )}
  </div>
  <label className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">

            <span min-w-0>Mode</span>
            <select
              className="justify-self-end w-auto bg-neutral-900 border border-neutral-600 rounded px-2 py-1"
              value={gs.ai.mode}
              onChange={(e) => setGs({ ...gs, ai: { ...gs.ai, mode: e.target.value as any } })}
            >
              <option value="human">Human vs Human</option>
              <option value="cpu">Human vs Computer</option>
            </select>
          </label>
          <label className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
            <span min-w-0>Computer plays</span>
            <select
              className="justify-self-end w-auto bg-neutral-900 border border-neutral-600 rounded px-2 py-1"
              value={gs.ai.cpuPlays}
              onChange={(e) => setGs({ ...gs, ai: { ...gs.ai, cpuPlays: e.target.value as Color } })}
            >
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </label>
          <label className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
            <spanmin-w-0>Level</span>
            <select
              className="justify-self-end w-auto bg-neutral-900 border border-neutral-600 rounded px-2 py-1"
              value={gs.ai.level}
              onChange={(e) => setGs({ ...gs, ai: { ...gs.ai, level: e.target.value as any } })}
            >
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
          </label>
        </div>
      </div>

      {/* Center: board */}
      <div
        className="grid grid-cols-8 grid-rows-8 select-none rounded-xl overflow-hidden shadow-2xl"
        style={{ border: "4px solid #3b2f2f" }}
      >
        {rankOrder.map((r) =>
          fileOrder.map((f) => {
            const sq = gs.board.find((s) => s.file === f && s.rank === r)!;
            const isSel = gs.selected === sq.id;
            const lm = gs.lastMove;
            const showAi = gs.ai.mode === "cpu" && lm && lm.by === gs.ai.cpuPlays;
            const isFrom = showAi && lm!.from === sq.id;
            const isTo = showAi && lm!.to === sq.id;
 const occ = sq.occupant;
  const hidesBlue =
    !!occ && occ.kind === "piece" && occ.coversBlueSymbol === true;
            return (
              <div
                key={sq.id}
                onClick={() => clickMove(sq)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, sq)}
                className={`relative w-20 h-20 ${isSel ? "outline outline-4 outline-emerald-400/80" : ""}`}
               style={{ background: woodSquareBg(f, r) }}
              >
                {isFrom && (
                  <div className="absolute inset-1 rounded-lg ring-4 ring-yellow-400/70 pointer-events-none" />
                )}
                {isTo && (
                  <div className="absolute inset-1 rounded-lg ring-4 ring-green-400/70 pointer-events-none" />
                )}

              
{sq.blueSymbol && r >= 3 && r <= 6 && !hidesBlue && (
  <BlueSymbol type={sq.blueSymbol} />
)}

                {sq.occupant?.kind === "metamorph" && (
                  <div draggable onDragStart={(e) => onDragStart(e, sq)}>
                    <Metamorph color={sq.occupant.color} />
                  </div>
                )}

                {sq.occupant?.kind === "piece" && (
                  <div draggable onDragStart={(e) => onDragStart(e, sq)}>
                    <Piece occ={sq.occupant} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Right panel: black chrysalis */}
      <div className="flex flex-col gap-3 w-48 shrink-0 items-end">
        <h2 className="text-lg font-semibold">Black chrysalis</h2>
        <StockView stock={blackStock} color="black" align="right" />
      </div>
 {/* Quietus – desktop old style */}
      <div className="fixed left-4 right-4 bottom-4 bg-neutral-800/90 backdrop-blur border border-neutral-700 rounded-2xl p-3 shadow-xl z-30">
        <div className="flex items-center justify-between">
          <div className="font-semibold tracking-wide">Quietus</div>
          <div className="text-xs opacity-70">Captured pieces · promotions revive from here if available</div>
        </div>

        {gs.winner && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 font-semibold text-sm">
            <span>Winner: </span>
            <span className="capitalize">{gs.winner}</span>
            {gs.winReason && <span> · {gs.winReason}</span>}
          </div>
        )}

        <div className="mt-2 grid grid-cols-2 gap-3">
          <QuietusRow label="White" color="white" counts={gs.quietus.white} />
          <QuietusRow label="Black" color="black" align="right" counts={gs.quietus.black} />
        </div>
      </div>

      {/* Rules modal (shared) */}
      {showRules && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setShowRules(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl p-6">
              <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
                Kafka Chess - Rules &amp; Information
              </h2>
              <p className="mb-4 opacity-90">
                This chess variant was developed by <strong>Kalin Yanev</strong> and his son, <strong>Ivaylo
                Yanev</strong>, in 2024, in Sofia, Bulgaria. They were not aware of chess variants prior to that; the
                game appeared as a result of sporadic contemplation assisted by a physical prototype (taken out in early afternoons).
              </p>
<img
  src="https://kafkachess.com/authors.JPG"
  alt="Authors Kalin and Ivaylo Yanevi"
  className="w-full rounded-xl mb-4 border border-neutral-700"
/>
              <h3 className="text-xl font-semibold mt-4 mb-2">Setup</h3>
              <ul className="list-disc pl-6 space-y-1 opacity-90">
                <li>
                  <strong>Board:</strong> 8×8 classical.
                </li>
                <li>
                  <strong>Ranks 1-2 and 7-8:</strong> filled with metamorphs (round tokens).
                </li>
                <li>
                  <strong>Ranks 3-6 - 'Metamorphia':</strong> every square displays a piece card - a shuffled layout of
                  all 32 classical chess pieces (no color division), one per square.
                </li>
                <li>
                  <strong>Chrysalis (outside the board):</strong> available piece supply (limited to starting counts of
                  the classical 16 per color/player) - drawn to transform when stepping on a piece card in Metamorphia (ranks
                  3-6); and restored back there when that piece changes type into another.
                </li>
                <li>
                  <strong>Quietus (outside the board):</strong> permanent graveyard of captured pieces; also the first
                  source for promotion choices.
                </li>
              </ul>

              <h3 className="text-xl font-semibold mt-4 mb-2">Pieces</h3>
              <ul className="list-disc pl-6 space-y-2 opacity-90">
                <li>
                  <strong>Metamorphs</strong> (16 per player): Move 1 square vertically toward the center;
                  no captures, no jumping, not capturable. On landing in Metamorphia (ranks 3-6) they transform into
                  that square’s piece card if available in the player's Chrysalis, and permanently disappear; otherwise, they remain
                  metamorphs and may keep moving vertically later. Could move on any rank, but not promotable if they
                  reach the last rank.
                </li>
                <li>
                  <strong>Rooks / Bishops / Queen / Knight:</strong> Standard chess movement, but confined to Metamorphia (ranks 3-6).
                </li>
                <li>
                  <strong>King:</strong> Standard chess movement, but confined to Metamorphia. *King safety: a king is
                  immune to capturing on the opponent’s immediate next turn after it appears on the board; an enemy king
                  can't be captured unless one's own king is on the board.
                </li>
                <li>
                  <strong>Pawns:</strong> Standard chess movement and capture. The only pieces except metamorphs allowed
                  to progress outside Metamorphia (outside ranks 3-6). On reaching the last rank they promote to any available
                  piece other than the King (taken from Quietus first, else Chrysalis). The promoted piece must return
                  to ranks 3–6 according to its classical movement next turn or it goes to Quietus.
                </li>
              </ul>

              <h3 className="text-xl font-semibold mt-4 mb-2">Rules</h3>
              <ul className="list-disc pl-6 space-y-2 opacity-90">
                <li>
                  <strong>Setting up and starting:</strong> Metamorphs are put on the board. Pieces are ordered in each
                  player's Chrysalis. The 32 piece cards are shuffled and - if in a physical game setting - dealt by the white player on Metamorphia's
                  ranks 3–6 (order: a6 → h6, a5 → h5, a4 → h4, a3 → h3). White moves first.
                </li>
                <li>
                  <strong>Metamorphia interactions:</strong> Landing on a piece card instantly transforms the unit into
                  that piece only if your Chrysalis has one available; otherwise, it stays as-is and will auto-transform
                  later if it remains on that square and needed stock appears.
                </li>
                <li>
                  <strong>Special rule for not blocking king piece cards by a metamorph:</strong> If a player has an
                  active king piece in the Metamorphia, it is forbidden for its metamorphs to step on an unoccupied king
                  piece card. Such a move is illegal and will be rejected.
                </li>
                <li>
                  <strong>Board restrictions:</strong> All real pieces must stay on ranks 3-6; only pawns may enter
                  outside. Metamorphs move only one square vertically toward the center and never capture or jump.
                </li>
                <li>
                  <strong>Chrysalis (piece supply):</strong> Limited to starting counts (K-1, Q-1, R-2, B-2, N-2, P-8).
                  When a unit transforms, the new piece is taken from the Chrysalis and the previous piece type is
                  returned back to the Chrysalis.
                </li>
                <li>
                  <strong>Quietus (captures):</strong> Captured pieces go here permanently. Promotion takes the chosen
                  piece from Quietus first, otherwise from Chrysalis.
                </li>
                <li>
                  <strong>Promotion rule:</strong> On reaching the last rank, a pawn promotes to any available piece in
                  Quietus or Chrysalis oher than King. The promoted piece must return to Metamorphia (ranks 3-6) on its very next turn or it goes to
                  Quietus. If both player's Chrysalis and Quietus are empty, the pawn does not transform; since it can't return to Metamorphia, on the next turn it is taken to Quietus.
                </li>
                <li>
                  <strong>Edge metamorph rule:</strong> Moving a metamorph 1 → 2 or 8 → 7 does not transform it.
                </li>
                <li>
                  <strong>King safety and capture:</strong> A king is immune to capture on the opponent’s immediate next
                  turn after it appears. You cannot capture the enemy king if your own king is not on the board.
                </li>
              </ul>

              <h3 className="text-xl font-semibold mt-4 mb-2">Victory conditions</h3>
              <ol className="list-decimal pl-6 space-y-1 opacity-90">
                <li>Capturing the king.</li>
                <li>
                  Opponent has no king and (no pawns or all pawns immobile) and (no metamorphs or all metamorphs
                  immobile).
                </li>
                <li>
                Metamorphic stalemate (a sole king is blocked by opposite metamorphs and/or own pieces which are blocked by opposite metamorphs) while the opposite player is kingless.
                </li>
                <li>
                  Threefold repetition when the opponent is kingless (the side with a king wins).
                </li>
                <li>50-move rule when the opponent is kingless. (The metamorphs have the same status as pawns regarding the rule - any move by a metamorph resents the count.)</li>
              </ol>

              <h3 className="text-xl font-semibold mt-4 mb-2">Draw conditions</h3>
              <ol className="list-decimal pl-6 space-y-1 opacity-90">
                <li>Metamorphic stalemate (both opponents are kingful, one of the kings is blocked by opposite metamorphs and/or by own pieces which are blocked by opposite metamorphs). </li>
                <li>
                  Threefold repetition when both players are either kingless, or both have kings.
                </li>
                <li>50-move rule when both players are either kingless, or kingful.</li>
                <li>Mutual agreement.</li>
              </ol>

              <p className="mt-4 opacity-90">
                <em>Classical exceptions:</em> 1). No castling,  2) no en passant, 3)  no checkmate (since taking the king - and hence moving into check - is allowed, 4) no classical chess stalemate (same reason) - a metamorphic stalemate instead, explained above.
              </p>
              <p className="mt-2 text-sm opacity-70">
                Feedback: <a className="underline" href="mailto:kalinyanev@yahoo.com">kalinyanev@yahoo.com</a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Promotion modal (shared) */}
      {gs.promotion && (
        <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center">
          <div className="bg-neutral-900 border border-neutral-700 p-4 rounded-xl w-[90%] max-w-[420px]">
            <div className="text-lg font-semibold mb-2">Promote pawn</div>
            <div className="grid grid-cols-4 gap-2">
  {(["Q", "R", "B", "N"] as PieceType[]).map((t) => (
    <button
      key={t}
      className="p-3 rounded-xl bg-white text-neutral-900 disabled:opacity-40"
      disabled={!promotionAvailable(gs, gs.promotion!.color, t)}
      onClick={() => handlePromotion(t)}
    >
      <span
        className="text-3xl leading-none"
        style={{
          fontFamily: "'Noto Chess','DejaVu Sans',serif",
          // white side promotes → light piece, black side → dark piece
         
           backgroundColor:
      gs.promotion?.color === "white"
        ? "#000000"  // light square for white promotion
        : "#ffffff", // dark square for black promotion
          color:
            gs.promotion?.color === "white"
              ? "#f5f5f5" 
              : "#111111", 

        }}
      >
        {pieceGlyph(t)}
      </span>
    </button>
  ))}

            </div>
            <div className="mt-3 text-sm opacity-80">
              Promote only to Q, R, B, or N. If available in Quietus, it will be taken from there first.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
