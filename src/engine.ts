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
  // Fast in modern Chrome/Firefox/Safari; fallback for older.
  // @ts-ignore
  return typeof structuredClone === "function"
    // @ts-ignore
    ? structuredClone(x)
    : JSON.parse(JSON.stringify(x));
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
  ai: { mode: "human" | "cpu"; cpuPlays: Color; level: "Easy" | "Medium" | "Hard" | "Master" };
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

let promoted = applyAutoTransforms(next).newGs;

// ✅ STALEMATE CHECK (promotion bypasses performMove's end-of-move checks)
const stal = stalemateOutcome(promoted);
if (stal) {
  promoted.winner = stal.winner; // null = draw
  promoted.winReason = stal.reason;
  promoted.message =
    stal.winner === null
      ? `Draw: ${stal.reason}`
      : `Winner: ${stal.winner} (${stal.reason})`;
  return promoted;
}

// After promotion, it's already opponent's turn (turn was flipped in performMove),
// so last mover is the opposite color:
const lastMoverColor: Color = promoted.turn === "white" ? "black" : "white";

const opponent: Color = promoted.turn;
const ksq = findKingSquare(promoted, opponent);

if (ksq) {
  const attackerHasKing = !!findKingSquare(promoted, lastMoverColor);
  const prot = promoted.kingProtectedUntil[opponent];
  const kingProtectedNow = prot !== null && promoted.moveNumber === prot;

  if (attackerHasKing && !kingProtectedNow) {
    const inCheck = isSquareAttacked(promoted, ksq.file, ksq.rank, lastMoverColor);
    if (inCheck) promoted.message = `Check on ${opponent}!`;
  }
}

return promoted;
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
if (gs.winReason) return gs;

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
  // STALEMATE
  const stal = stalemateOutcome(newGs);
  if (stal) {
    newGs.winner = stal.winner;          // null = draw
    newGs.winReason = stal.reason;
    newGs.message =
      stal.winner === null
        ? `Draw: ${stal.reason}`
        : `Winner: ${stal.winner} (${stal.reason})`;
    return newGs;
  }

  // existing "Check on ..." logic
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
  // Material values used ONLY for move ordering (not evaluation)
  const val: Record<PieceType, number> = {
    K: 5000,
    Q: 900,
    R: 500,
    B: 330,
    N: 320,
    P: 100,
  };

  const out: { from: SquareId; to: SquareId; next: GameState; order: number }[] = [];
  const base = deepClone(gs);
  base.turn = c;
  const startMoveNumber = base.moveNumber;

  const other: Color = c === "white" ? "black" : "white";

  // quick helpers for ordering
  const squareById = (st: GameState, id: SquareId) => st.board.find((s) => s.id === id)!;

  const givesCheck = (st: GameState) => {
    const ksq = findKingSquare(st, other);
    if (!ksq) return false;
    // "check" only matters if attacker has a king and opponent isn't protected that turn (same as your rules)
    const attackerHasKing = !!findKingSquare(st, c);
    const prot = st.kingProtectedUntil[other];
    const kingProtectedNow = prot !== null && st.moveNumber === prot;
    if (!attackerHasKing || kingProtectedNow) return false;
    return isSquareAttacked(st, ksq.file, ksq.rank, c);
  };

  const scoreMove = (before: GameState, from: SquareId, to: SquareId, after: GameState, after2: GameState) => {
    let s = 0;

    const fromSq = squareById(before, from);
    const toSq = squareById(before, to);

    // 1) Captures first (huge for pruning)
    if (toSq.occupant && toSq.occupant.kind === "piece" && toSq.occupant.color !== c) {
      const t = toSq.occupant.type;
      s += 100000 + val[t]; // capture bonus + MVV
      if (t === "K") s += 1000000; // king capture is decisive
    }

    // 2) Promotions (AI resolves immediately via aiResolvePromotion)
    // If move opened promotion panel and aiResolvePromotion changed state, prefer it
    if (after.promotion && after.promotion.color === c && !after2.promotion) {
      s += 80000;
    }

    // 3) Transform / change type on Metamorphia card (your rules change piece type)
    const beforeOcc = fromSq.occupant && fromSq.occupant.kind === "piece" ? fromSq.occupant.type : null;
    const afterTo = squareById(after2, to);
    const afterOcc = afterTo.occupant && afterTo.occupant.kind === "piece" ? afterTo.occupant.type : null;
    if (beforeOcc && afterOcc && beforeOcc !== afterOcc) {
      s += 20000 + (val[afterOcc] - val[beforeOcc]); // prefer “upgrade”
    }

    // 4) Giving check (in *your* rules)
    if (givesCheck(after2)) s += 15000;

    // 5) Small bonus: entering Metamorphia (ranks 3–6) is generally useful in your eval too
    if (toSq.rank >= 3 && toSq.rank <= 6) s += 200;

    // 6) Winning move
    if (after2.winner === c) s += 10_000_000;

    return s;
  };

  for (const sq of base.board) {
    const o = sq.occupant;
    if (!o) continue;

    if (o.kind === "metamorph" && o.color === c) {
      const moves = legalMovesForMetamorph(base, sq);
      for (const m of moves) {
        const to = idFrom(m.f, m.r);
        const n = performMove(base, sq.id, to);
        const n2 = n.promotion && n.promotion.color === c ? aiResolvePromotion(n, c) : n;

        // Ignore illegal/no-op moves (same rule you already have)
        if (n2.moveNumber === startMoveNumber) continue;

        out.push({ from: sq.id, to, next: n2, order: scoreMove(base, sq.id, to, n, n2) });
      }
    } else if (o.kind === "piece" && o.color === c) {
      const moves = legalMovesForPiece(base, sq);
      for (const m of moves) {
        const to = idFrom(m.f, m.r);
        const n = performMove(base, sq.id, to);
        const n2 = n.promotion && n.promotion.color === c ? aiResolvePromotion(n, c) : n;

        if (n2.moveNumber === startMoveNumber) continue;

        out.push({ from: sq.id, to, next: n2, order: scoreMove(base, sq.id, to, n, n2) });
      }
    }
  }

  // This is the key: GOOD moves first => alpha-beta cuts much more.
  out.sort((a, b) => b.order - a.order);

  // keep the original return shape
  return out.map(({ from, to, next }) => ({ from, to, next }));
}

function countMovesFast(gs: GameState, c: Color) {
  // same as generateMoves but returns only count and does not allocate/sort
  let count = 0;
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
        const n2 = n.promotion && n.promotion.color === c ? aiResolvePromotion(n, c) : n;
        if (n2.moveNumber === startMoveNumber) continue;
        count++;
      }
    } else if (o.kind === "piece" && o.color === c) {
      const moves = legalMovesForPiece(base, sq);
      for (const m of moves) {
        const n = performMove(base, sq.id, idFrom(m.f, m.r));
        const n2 = n.promotion && n.promotion.color === c ? aiResolvePromotion(n, c) : n;
        if (n2.moveNumber === startMoveNumber) continue;
        count++;
      }
    }
  }

  return count;
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

  const my = countMovesFast(gs, forC);
const op = countMovesFast(gs, forC === "white" ? "black" : "white");


  return score + (my - op) * 0.5;
}

export function pickAiMove(gs: GameState): GameState {
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
  } else {
    let v = Infinity;
    for (const mv of list) {
      v = Math.min(v, minimax(mv.next, d - 1, a, b, true, maxC));
      b = Math.min(b, v);
      if (b <= a) break;
    }
    return v;
  }
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

export { pickAiMove, generateMoves, evaluate, minimax, performMove, deepClone };
export type { GameState, Color, PieceType, SquareId };
