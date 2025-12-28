// src/engine.ts
// Extracted exactly from App.tsx (engine-only: no React/JSX)

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

const idFrom = (file: FileLetter, rank: RankNum): SquareId => `${file}${rank}`;
const inBounds = (fIdx: number, r: number) => fIdx >= 0 && fIdx < 8 && r >= 1 && r <= 8;

type Occupant =
  | {
      kind: "piece";
      color: Color;
      type: PieceType;
      metamorph?: boolean;
      returnedPawn?: boolean;
      transformed?: boolean;
      bornAtTurn: number;
    }
  | {
      kind: "stock";
      color: Color;
      type: PieceType;
    };

interface Square {
  id: SquareId;
  file: FileLetter;
  rank: RankNum;
  dark: boolean;
  blueSymbol: boolean;
  occupant: Occupant | null;
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
  ai: { mode: "human" | "cpu"; cpuPlays: Color; level: "Easy" | "Medium" | "Hard" | "Master" };
  lastMove: { from: SquareId; to: SquareId } | null;
  repetition: Record<string, number>;
}

const INITIAL_COUNTS: ChrysalisStock = { K: 1, Q: 1, R: 2, B: 2, N: 2, P: 8 };

const emptyStock = (): ChrysalisStock => ({ K: 0, Q: 0, R: 0, B: 0, N: 0, P: 0 });
const zeroStock = emptyStock;

const woodColor = (sq: Square) => (sq.dark ? "#7a4f2f" : "#d6b187");

const shade = (hex: string, amt: number) => {
  const n = hex.replace("#", "");
  const r = Math.max(0, Math.min(255, parseInt(n.slice(0, 2), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(n.slice(2, 4), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(n.slice(4, 6), 16) + amt));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;
};

const woodSquareBg = (sq: Square) => shade(woodColor(sq), sq.blueSymbol ? 30 : 0);

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function encodePosition(gs: GameState) {
  const pieces = gs.board
    .map((sq) => {
      if (!sq.occupant) return ".";
      const o = sq.occupant;
      if (o.kind === "stock") return `${o.color[0]}S${o.type}`;
      const base = `${o.color[0]}${o.type}`;
      const meta = o.metamorph ? "m" : "";
      const ret = o.returnedPawn ? "r" : "";
      const tr = o.transformed ? "t" : "";
      return base + meta + ret + tr;
    })
    .join("");
  return `${pieces}|${gs.turn}`;
}

function createInitialBoard(): Square[] {
  const board: Square[] = [];
  for (let r = 8; r >= 1; r--) {
    for (let f = 0; f < 8; f++) {
      const file = FILES[f];
      const rank = r as RankNum;
      const id = idFrom(file, rank);
      const dark = (f + r) % 2 === 1;
      const blueSymbol = rank >= 3 && rank <= 6;
      board.push({
        id,
        file,
        rank,
        dark,
        blueSymbol,
        occupant: null,
      });
    }
  }

  for (let f = 0; f < 8; f++) {
    const w = board.find((s) => s.file === FILES[f] && s.rank === 2)!;
    w.occupant = { kind: "piece", color: "white", type: "P", bornAtTurn: 0 };
    const b = board.find((s) => s.file === FILES[f] && s.rank === 7)!;
    b.occupant = { kind: "piece", color: "black", type: "P", bornAtTurn: 0 };
  }

  const back: PieceType[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let f = 0; f < 8; f++) {
    const w = board.find((s) => s.file === FILES[f] && s.rank === 1)!;
    w.occupant = { kind: "piece", color: "white", type: back[f], bornAtTurn: 0 };
    const b = board.find((s) => s.file === FILES[f] && s.rank === 8)!;
    b.occupant = { kind: "piece", color: "black", type: back[f], bornAtTurn: 0 };
  }

  return board;
}

function initialGame(): GameState {
  const board = createInitialBoard();
  const repKey = `${board
    .map((sq) => {
      if (!sq.occupant) return ".";
      if (sq.occupant.kind === "stock") return `${sq.occupant.color[0]}S${sq.occupant.type}`;
      return `${sq.occupant.color[0]}${sq.occupant.type}`;
    })
    .join("")}|white`;

  return {
    board,
    turn: "white",
    moveNumber: 1,
    stock: { white: deepClone(INITIAL_COUNTS), black: deepClone(INITIAL_COUNTS) },
    quietus: { white: emptyStock(), black: emptyStock() },
    kingOnBoard: { white: true, black: true },
    kingProtectedUntil: { white: null, black: null },
    selected: null,
    promotion: null,
    message: null,
    winner: null,
    winReason: null,
    ai: { mode: "human", cpuPlays: "black", level: "Hard" },
    lastMove: null,
    repetition: { [repKey]: 1 },
  };
}

const opponent = (c: Color) => (c === "white" ? "black" : "white");

function legalMovesForPiece(gs: GameState, from: SquareId) {
  const sq = gs.board.find((s) => s.id === from);
  if (!sq || !sq.occupant || sq.occupant.kind !== "piece") return [];
  const o = sq.occupant;
  const c = o.color;
  const moves: { f: FileLetter; r: RankNum }[] = [];
  const fIdx = FILES.indexOf(sq.file);

  const add = (df: number, dr: number, repeat: boolean) => {
    let nf = fIdx + df;
    let nr = (sq.rank + dr) as number;
    while (inBounds(nf, nr)) {
      const nid = idFrom(FILES[nf], nr as RankNum);
      const target = gs.board.find((x) => x.id === nid)!;
      if (target.occupant) {
        if (target.occupant.kind === "stock" || target.occupant.color !== c) moves.push({ f: FILES[nf], r: nr as RankNum });
        break;
      } else {
        moves.push({ f: FILES[nf], r: nr as RankNum });
      }
      if (!repeat) break;
      nf += df;
      nr += dr;
    }
  };

  if (o.type === "P") {
    const dir = c === "white" ? 1 : -1;

    const fwdRank = (sq.rank + dir) as number;
    if (inBounds(fIdx, fwdRank)) {
      const fwdId = idFrom(sq.file, fwdRank as RankNum);
      const fwdSq = gs.board.find((x) => x.id === fwdId)!;
      if (!fwdSq.occupant) moves.push({ f: sq.file, r: fwdRank as RankNum });
    }

    for (const df of [-1, 1]) {
      const nf = fIdx + df;
      const nr = (sq.rank + dir) as number;
      if (!inBounds(nf, nr)) continue;
      const nid = idFrom(FILES[nf], nr as RankNum);
      const t = gs.board.find((x) => x.id === nid)!;
      if (t.occupant && (t.occupant.kind === "stock" || t.occupant.color !== c)) moves.push({ f: FILES[nf], r: nr as RankNum });
    }
  } else if (o.type === "N") {
    const jumps = [
      [1, 2],
      [2, 1],
      [2, -1],
      [1, -2],
      [-1, -2],
      [-2, -1],
      [-2, 1],
      [-1, 2],
    ];
    for (const [df, dr] of jumps) {
      const nf = fIdx + df;
      const nr = (sq.rank + dr) as number;
      if (!inBounds(nf, nr)) continue;
      const nid = idFrom(FILES[nf], nr as RankNum);
      const t = gs.board.find((x) => x.id === nid)!;
      if (!t.occupant || t.occupant.kind === "stock" || t.occupant.color !== c) moves.push({ f: FILES[nf], r: nr as RankNum });
    }
  } else if (o.type === "B") {
    add(1, 1, true);
    add(1, -1, true);
    add(-1, 1, true);
    add(-1, -1, true);
  } else if (o.type === "R") {
    add(1, 0, true);
    add(-1, 0, true);
    add(0, 1, true);
    add(0, -1, true);
  } else if (o.type === "Q") {
    add(1, 0, true);
    add(-1, 0, true);
    add(0, 1, true);
    add(0, -1, true);
    add(1, 1, true);
    add(1, -1, true);
    add(-1, 1, true);
    add(-1, -1, true);
  } else if (o.type === "K") {
    for (const df of [-1, 0, 1]) {
      for (const dr of [-1, 0, 1]) {
        if (df === 0 && dr === 0) continue;
        const nf = fIdx + df;
        const nr = (sq.rank + dr) as number;
        if (!inBounds(nf, nr)) continue;
        const nid = idFrom(FILES[nf], nr as RankNum);
        const t = gs.board.find((x) => x.id === nid)!;
        if (!t.occupant || t.occupant.kind === "stock" || t.occupant.color !== c) moves.push({ f: FILES[nf], r: nr as RankNum });
      }
    }
  }

  return moves;
}

function legalMovesForMetamorph(gs: GameState, from: SquareId) {
  const sq = gs.board.find((s) => s.id === from);
  if (!sq || !sq.occupant || sq.occupant.kind !== "piece" || !sq.occupant.metamorph) return [];
  const o = sq.occupant;
  const c = o.color;
  const moves: { f: FileLetter; r: RankNum }[] = [];
  const fIdx = FILES.indexOf(sq.file);

  for (const df of [-1, 0, 1]) {
    for (const dr of [-1, 0, 1]) {
      if (df === 0 && dr === 0) continue;
      const nf = fIdx + df;
      const nr = (sq.rank + dr) as number;
      if (!inBounds(nf, nr)) continue;
      const nid = idFrom(FILES[nf], nr as RankNum);
      const t = gs.board.find((x) => x.id === nid)!;
      if (!t.occupant || t.occupant.kind === "stock" || t.occupant.color !== c) moves.push({ f: FILES[nf], r: nr as RankNum });
    }
  }

  return moves;
}

function applyAutoTransforms(gs: GameState) {
  const next = deepClone(gs);

  next.board.forEach((sq) => {
    const o = sq.occupant;
    if (!o || o.kind !== "piece") return;

    if (sq.blueSymbol && o.type !== "K") {
      if (!o.metamorph) o.metamorph = true;
    } else {
      if (o.metamorph) o.metamorph = false;
    }
  });

  return next;
}

function isSquareAttacked(gs: GameState, target: SquareId, by: Color) {
  for (const sq of gs.board) {
    const o = sq.occupant;
    if (!o || o.kind !== "piece" || o.color !== by) continue;
    const moves = o.metamorph ? legalMovesForMetamorph(gs, sq.id) : legalMovesForPiece(gs, sq.id);
    if (moves.some((m) => idFrom(m.f, m.r) === target)) return true;
  }
  return false;
}

function findKingSquare(gs: GameState, c: Color) {
  return gs.board.find((sq) => sq.occupant && sq.occupant.kind === "piece" && sq.occupant.color === c && sq.occupant.type === "K") || null;
}

function kingInCheck(gs: GameState, c: Color) {
  const k = findKingSquare(gs, c);
  if (!k) return false;
  return isSquareAttacked(gs, k.id, opponent(c));
}

function anyMoveAvailable(gs: GameState, c: Color) {
  return gs.board.some((sq) => {
    const o = sq.occupant;
    if (!o || o.kind !== "piece" || o.color !== c) return false;
    const mv = o.metamorph ? legalMovesForMetamorph(gs, sq.id) : legalMovesForPiece(gs, sq.id);
    return mv.length > 0;
  });
}

function stalemateOutcome(gs: GameState, sideToMove: Color): { winner: Color | null; reason: string | null } | null {
  if (anyMoveAvailable(gs, sideToMove)) return null;
  if (kingInCheck(gs, sideToMove)) return null;
  return { winner: null, reason: "Stalemate" };
}

function activeCounts(gs: GameState, c: Color) {
  const counts: ChrysalisStock = emptyStock();
  gs.board.forEach((sq) => {
    const o = sq.occupant;
    if (o && o.kind === "piece" && o.color === c) counts[o.type] += 1;
  });
  return counts;
}

const promotionAvailable = (gs: GameState, c: Color) => {
  const counts = activeCounts(gs, c);
  const stock = gs.stock[c];
  const lastRank = c === "white" ? 8 : 1;
  const hasPawnOnLast = gs.board.some(
    (sq) => sq.rank === lastRank && sq.occupant?.kind === "piece" && sq.occupant.color === c && sq.occupant.type === "P"
  );
  const canChoose = stock.Q - counts.Q > 0 || stock.R - counts.R > 0 || stock.B - counts.B > 0 || stock.N - counts.N > 0;
  return hasPawnOnLast && canChoose;
};

function applyPromotionChoice(gs: GameState, square: SquareId, newType: Exclude<PieceType, "P" | "K">) {
  const next = deepClone(gs);
  const sq = next.board.find((s) => s.id === square);
  if (!sq || !sq.occupant || sq.occupant.kind !== "piece") return next;
  const o = sq.occupant;
  if (o.type !== "P") return next;
  o.type = newType;
  o.transformed = true;
  next.promotion = null;
  return next;
}

function detectWin(gs: GameState, lastMover: Color, messageSetter: ((m: string | null) => void) | null): { winner: Color | null; reason: string | null } | null {
  const wk = !!findKingSquare(gs, "white");
  const bk = !!findKingSquare(gs, "black");

  if (!wk && bk) {
    if (messageSetter) messageSetter("White king removed. Black wins.");
    return { winner: "black", reason: "White king removed" };
  } else if (!bk && wk) {
    if (messageSetter) messageSetter("Black king removed. White wins.");
    return { winner: "white", reason: "Black king removed" };
  } else if (!wk && !bk) {
    if (messageSetter) messageSetter("Both kings removed.");
    return { winner: null, reason: "Both kings removed" };
  }

  return null;
}

function enforceReturnOrQuietus(gs: GameState) {
  const next = deepClone(gs);

  next.board.forEach((sq) => {
    const o = sq.occupant;
    if (!o || o.kind !== "piece") return;

    if (o.returnedPawn) {
      const age = next.moveNumber - o.bornAtTurn;
      if (age >= 2 && sq.blueSymbol) {
        // If returned pawn reached a blue symbol square in time, clear flag.
        o.returnedPawn = false;
      } else if (age >= 2 && !sq.blueSymbol) {
        // Send to Quietus
        next.quietus[o.color][o.type] += 1;
        sq.occupant = null;
      }
    }
  });

  return next;
}

function performMove(gs: GameState, from: SquareId, to: SquareId): GameState {
  let next = deepClone(gs);

  const src = next.board.find((s) => s.id === from);
  const dst = next.board.find((s) => s.id === to);

  if (!src || !dst || !src.occupant || src.occupant.kind !== "piece") return next;

  const mover = src.occupant;

  // Can't capture own
  if (dst.occupant && dst.occupant.kind !== "stock" && dst.occupant.color === mover.color) return next;

  // Capture stock or piece
  if (dst.occupant) {
    if (dst.occupant.kind === "stock") {
      // Taking from opponent stock reduces their stock
      next.stock[dst.occupant.color][dst.occupant.type] = Math.max(0, next.stock[dst.occupant.color][dst.occupant.type] - 1);
    } else {
      // Captured piece goes into quietus as its type
      next.quietus[dst.occupant.color][dst.occupant.type] += 1;
    }
  }

  dst.occupant = mover;
  src.occupant = null;

  next.lastMove = { from, to };

  // Promotion trigger
  if (mover.type === "P") {
    const lastRank = mover.color === "white" ? 8 : 1;
    if (dst.rank === lastRank) {
      next.promotion = { square: dst.id, color: mover.color };
    }
  }

  next = applyAutoTransforms(next);
  next = enforceReturnOrQuietus(next);

  // Switch turn & move number
  next.turn = opponent(next.turn);
  if (next.turn === "white") next.moveNumber += 1;

  // Repetition update
  const key = encodePosition(next);
  next.repetition[key] = (next.repetition[key] ?? 0) + 1;

  return next;
}

function aiResolvePromotion(gs: GameState): GameState {
  if (!gs.promotion) return gs;
  const c = gs.promotion.color;
  const counts = activeCounts(gs, c);
  const stock = gs.stock[c];

  const opts: Exclude<PieceType, "P" | "K">[] = ["Q", "R", "B", "N"];
  for (const t of opts) {
    const avail = stock[t] - counts[t] > 0;
    if (avail) return applyPromotionChoice(gs, gs.promotion.square, t);
  }

  const next = deepClone(gs);
  next.promotion = null;
  return next;
}

function generateMoves(gs: GameState, forC: Color) {
  const base = deepClone(gs);
  base.selected = null;

  const res: { from: SquareId; to: SquareId; next: GameState }[] = [];

  for (const sq of base.board) {
    const o = sq.occupant;
    if (!o || o.kind !== "piece" || o.color !== forC) continue;

    const moves = o.metamorph ? legalMovesForMetamorph(base, sq.id) : legalMovesForPiece(base, sq.id);
    for (const m of moves) {
      const to = idFrom(m.f, m.r);
      const n = performMove(base, sq.id, to);
      const nn = aiResolvePromotion(n);
      res.push({ from: sq.id, to, next: nn });
    }
  }

  return res;
}

function evaluate(gs: GameState, forC: Color) {
  const values: Record<PieceType, number> = { K: 1000, Q: 9, R: 5, B: 3, N: 3, P: 1 };

  let score = 0;
  for (const sq of gs.board) {
    const o = sq.occupant;
    if (!o || o.kind !== "piece") continue;
    const v = values[o.type] + (o.metamorph ? 0.2 : 0) + (o.transformed ? 0.1 : 0);
    score += o.color === forC ? v : -v;
  }

  if (gs.winner) score += gs.winner === forC ? 10000 : -10000;

  // mobility is intentionally not included here (your original file computed it elsewhere)
  return score;
}

function pickAiMove(gs: GameState): GameState {
  const ai = gs.ai;
  const c = ai.cpuPlays;
  if (gs.turn !== c) return gs;

  if (gs.promotion && gs.promotion.color === c) return aiResolvePromotion(gs);

  const moves = generateMoves(gs, c);
  if (moves.length === 0) return gs;

  if (ai.level === "Easy") {
    const mv = moves[Math.floor(Math.random() * moves.length)];
    return mv.next;
  }

  if (ai.level === "Medium") {
    let best = -Infinity;
    let bn = moves[0].next;
    for (const mv of moves) {
      const sc = evaluate(mv.next, c);
      if (sc > best) {
        best = sc;
        bn = mv.next;
      }
    }
    return bn;
  }

  const minimax = (st: GameState, depth: number, alpha: number, beta: number, maximizing: boolean, maxC: Color): number => {
    if (depth === 0 || st.winner || st.winReason) return evaluate(st, maxC);

    const side = maximizing ? maxC : opponent(maxC);
    const children = generateMoves(st, side);
    if (children.length === 0) return evaluate(st, maxC);

    if (maximizing) {
      let best = -Infinity;
      for (const ch of children) {
        const val = minimax(ch.next, depth - 1, alpha, beta, false, maxC);
        best = Math.max(best, val);
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const ch of children) {
        const val = minimax(ch.next, depth - 1, alpha, beta, true, maxC);
        best = Math.min(best, val);
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
      }
      return best;
    }
  };

  const depth = ai.level === "Master" ? 2 : 1;

  let best = -Infinity;
  let bn = moves[0].next;
  for (const mv of moves) {
    const sc = minimax(mv.next, depth, -Infinity, Infinity, false, c);
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
  console.assert(g.board.filter((s) => s.rank >= 3 && s.rank <= 6 && s.blueSymbol).length === 32, "blue32");

  (["K", "Q", "R", "B", "N", "P"] as PieceType[])
    .map((x: PieceType) => pieceGlyph(x))
    .forEach((ch: string) => {
      console.assert(typeof ch === "string" && ch.length > 0, "glyph");
    });

  const repKeys = Object.keys(g.repetition);
  console.assert(repKeys.length === 1 && g.repetition[repKeys[0]] === 1, "repetition init");

  const empty = initialGame();
  const kTest = deepClone(empty);
  const a4 = kTest.board.find((sq) => sq.id === "a4");
  if (a4) {
    a4.occupant = { kind: "piece", color: "black", type: "K", bornAtTurn: 0 };
  }
  kTest.turn = "white";
  const res = detectWin(kTest, "black", null);
  console.assert(!!res && res!.winner === "black", "king detection when only black has king");
}

export type { FileLetter, RankNum, Color, PieceType, SquareId, Occupant, Square, ChrysalisStock, GameState };

export {
  FILES,
  RANKS,
  GLYPH,
  pieceGlyph,
  idFrom,
  inBounds,
  shade,
  woodColor,
  woodSquareBg,
  deepClone,
  encodePosition,
  createInitialBoard,
  initialGame,
  legalMovesForPiece,
  legalMovesForMetamorph,
  applyAutoTransforms,
  isSquareAttacked,
  findKingSquare,
  kingInCheck,
  stalemateOutcome,
  promotionAvailable,
  applyPromotionChoice,
  detectWin,
  enforceReturnOrQuietus,
  performMove,
  aiResolvePromotion,
  generateMoves,
  evaluate,
  pickAiMove,
  runSelfTests,
};
