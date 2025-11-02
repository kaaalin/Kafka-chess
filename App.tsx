import React, { useEffect, useRef, useState } from "react";

const FILES = ["a","b","c","d","e","f","g","h"] as const;
const RANKS = [1,2,3,4,5,6,7,8] as const; // rank 1 at top visually in this implementation

type Color = "white" | "black";
type PieceType = "K"|"Q"|"R"|"B"|"N"|"P";
type SquareId = `${typeof FILES[number]}${typeof RANKS[number]}`;

type Occupant =
  | { kind: "metamorph"; color: Color }
  | { kind: "piece"; color: Color; type: PieceType; bornAtTurn: number; mustReturn?: boolean; returnByTurn?: number }
  | null;

interface Square {
  id: SquareId;
  file: number; // 0..7
  rank: number; // 1..8
  blueSymbol?: PieceType; // present only on ranks 3..6
  occupant: Occupant;
}

interface ChrysalisStock { K: number; Q: number; R: number; B: number; N: number; P: number; }

interface GameState {
  board: Square[];
  turn: Color; // white starts
  moveNumber: number; // increases after each move
  stock: { white: ChrysalisStock; black: ChrysalisStock };
  quietus: { white: ChrysalisStock; black: ChrysalisStock }; // captured pieces listed in Quietus
  kingOnBoard: { white: boolean; black: boolean };
  kingProtectedUntil: { white: number | null; black: number | null }; // moveNumber when king is protected from capture
  selected?: SquareId | null;
  promotion?: { square: SquareId; color: Color } | null;
  message?: string | null;
  winner?: Color | null;
  winReason?: string | null;
  ai: { mode: 'human' | 'cpu'; cpuPlays: Color; level: 'Easy' | 'Medium' | 'Hard' };
  lastMove?: { from: SquareId; to: SquareId; by: Color } | null;
}

const idFrom = (file: number, rank: number): SquareId => `${FILES[file]}${rank}` as SquareId;

const emptyStock = (): ChrysalisStock => ({ K:1, Q:1, R:2, B:2, N:2, P:8 });
const zeroStock  = (): ChrysalisStock => ({ K:0, Q:0, R:0, B:0, N:0, P:0 });

const deepClone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function createInitialBoard(): Square[] {
  const board: Square[] = [];
  for (let r of RANKS) {
    for (let f = 0; f < 8; f++) {
      board.push({ id: idFrom(f, r), file: f, rank: r, occupant: null });
    }
  }

  // Randomize blue symbols across ranks 3..6 (two full armies worth)
  const bag: PieceType[] = [];
  const pack: ChrysalisStock = emptyStock();
  for (const [t, n] of Object.entries(pack) as [PieceType, number][]) {
    for (let i = 0; i < n * 2; i++) bag.push(t);
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  let k = 0;
  for (let r = 3; r <= 6; r++) {
    for (let f = 0; f < 8; f++) {
      const s = board.find(sq => sq.rank === r && sq.file === f)!;
      s.blueSymbol = bag[k++];
    }
  }

  // Fill metamorphs on ranks 1-2 (black) and 7-8 (white)
  for (let r of [1,2]) for (let f = 0; f < 8; f++) {
    const s = board.find(sq => sq.rank === r && sq.file === f)!;
    s.occupant = { kind: "metamorph", color: "black" };
  }
  for (let r of [7,8]) for (let f = 0; f < 8; f++) {
    const s = board.find(sq => sq.rank === r && sq.file === f)!;
    s.occupant = { kind: "metamorph", color: "white" };
  }
  return board;
}

function initialGame(): GameState {
  return {
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
    ai: { mode: 'human', cpuPlays: 'black', level: 'Medium' },
    lastMove: null,
  };
}

const inBounds = (f:number,r:number)=> f>=0 && f<8 && r>=1 && r<=8;

function legalMovesForPiece(gs: GameState, from: Square): {f:number;r:number}[] {
  const occ = from.occupant as Extract<Occupant,{kind:"piece"}>;
  const color = occ.color;
  const board = gs.board;
  const moves: {f:number;r:number}[] = [];

  const f0 = from.file, r0 = from.rank;
  const limitTo316 = !(occ.mustReturn);

  function canLand(nf:number,nr:number){
    if(!inBounds(nf,nr)) return false;
    if(limitTo316 && !(nr>=3 && nr<=6)) return false;
    const o = board.find(s=>s.file===nf && s.rank===nr)!.occupant;
    return !o || (o.kind==="piece" && o.color!==color);
  }

  function pushRays(dirs: [number,number][]) {
    for (const [df,dr] of dirs){
      let nf=f0+df, nr=r0+dr;
      while(inBounds(nf,nr)){
        if(limitTo316 && !(nr>=3 && nr<=6)) break;
        const o = board.find(s=>s.file===nf && s.rank===nr)!.occupant;
        if(!o){ moves.push({f:nf,r:nr}); } else { if(o.kind==="piece" && o.color!==color) moves.push({f:nf,r:nr}); break; }
        nf+=df; nr+=dr;
      }
    }
  }

  switch(occ.type){
    case "N": {
      const deltas = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]] as const;
      for (const [df,dr] of deltas){
        const nf=f0+df, nr=r0+dr;
        if(canLand(nf,nr)) moves.push({f:nf,r:nr});
      }
      break;
    }
    case "B": pushRays([[1,1],[1,-1],[-1,1],[-1,-1]]); break;
    case "R": pushRays([[1,0],[-1,0],[0,1],[0,-1]]); break;
    case "Q": pushRays([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]); break;
    case "K": {
      for (let df=-1; df<=1; df++) for (let dr=-1; dr<=1; dr++){
        if(df===0 && dr===0) continue;
        const nf=f0+df, nr=r0+dr;
        if(canLand(nf,nr)) moves.push({f:nf,r:nr});
      }
      break;
    }
    case "P": {
      const dir = color === "white" ? -1 : 1;
      const oneR = r0 + dir;

      if(inBounds(f0, oneR)){
        const front = board.find(s=>s.file===f0 && s.rank===oneR)!;
        if(!front.occupant) moves.push({f:f0,r:oneR});
      }

      for(const df of [-1,1]){
        const nf=f0+df, nr=r0+dir;
        if(!inBounds(nf,nr)) continue;
        const o = board.find(s=>s.file===nf && s.rank===nr)!.occupant;
        if(o && o.kind==="piece" && o.color!==color){
          moves.push({f:nf,r:nr});
        }
      }
      break;
    }
  }
  return moves;
}

function legalMovesForMetamorph(gs: GameState, from: Square): {f:number;r:number}[] {
  const m = from.occupant as Extract<Occupant,{kind:"metamorph"}>;
  const dir = m.color === "white" ? -1 : 1; // toward center
  const f0 = from.file, r0 = from.rank;
  const nr = r0 + dir;
  if(!inBounds(f0,nr)) return [];
  const dest = gs.board.find(s=>s.file===f0 && s.rank===nr)!;
  if(dest.occupant) return []; // cannot move onto occupied (no captures, no jumping)
  return [{f:f0, r:nr}];
}

function applyAutoTransforms(gs: GameState) {
  const newGs = deepClone(gs);
  for (const sq of newGs.board) {
    if(!(sq.rank>=3 && sq.rank<=6)) continue;
    if(!sq.blueSymbol) continue;
    if(!sq.occupant) continue;

    if(sq.occupant.kind === "metamorph"){
      const color = sq.occupant.color;
      const needed = sq.blueSymbol;
      if(newGs.stock[color][needed] > 0){
        newGs.stock[color][needed] -= 1;
        sq.occupant = { kind: "piece", color, type: needed, bornAtTurn: newGs.moveNumber };
        if(needed === "K"){ newGs.kingOnBoard[color] = true; newGs.kingProtectedUntil[color] = newGs.moveNumber; }
      }
    } else if (sq.occupant.kind === "piece") {
      const color = sq.occupant.color;
      const current = sq.occupant.type;
      const needed = sq.blueSymbol;
      if(current !== needed && newGs.stock[color][needed] > 0){
        newGs.stock[color][current] = Math.min(INITIAL_COUNTS[current], newGs.stock[color][current] + 1);
        newGs.stock[color][needed] -= 1;
        sq.occupant = { kind: "piece", color, type: needed, bornAtTurn: newGs.moveNumber };
        if(current === "K" && needed !== "K") { newGs.kingOnBoard[color] = false; }
        if(needed === "K"){ newGs.kingOnBoard[color] = true; newGs.kingProtectedUntil[color] = newGs.moveNumber; }
      }
    }
  }
  return { newGs, changed: true };
}

function performMove(gs: GameState, fromId: SquareId, toId: SquareId): GameState {
  if (gs.winner) return gs; // game over lock
  const sFrom = gs.board.find(s=>s.id===fromId)!;
  const sTo = gs.board.find(s=>s.id===toId)!;
  const mover = sFrom.occupant;
  if(!mover) return gs;

  const next = deepClone(gs);
  const from = next.board.find(s=>s.id===fromId)!;
  const to = next.board.find(s=>s.id===toId)!;

  let legal: {f:number;r:number}[] = [];
  if(mover.kind === "metamorph") {
    if(mover.color !== next.turn) return gs;
    legal = legalMovesForMetamorph(gs, sFrom);
  } else {
    if(mover.color !== next.turn) return gs;
    legal = legalMovesForPiece(gs, sFrom);
  }
  const isLegal = legal.some(m => m.f===to.file && m.r===to.rank);
  if(!isLegal) return { ...gs, message: "Illegal move." };

  const target = to.occupant;
  let capturedKing: Color | null = null;
  if(target && target.kind === "piece"){
    if(target.type === "K"){
      const attackerColor = mover.color;
      if(!gs.kingOnBoard[attackerColor]){
        return { ...gs, message: "You cannot take the king without your own king on the board." };
      }
      const prot = gs.kingProtectedUntil[target.color];
      if(prot !== null && gs.moveNumber === prot){
        return { ...gs, message: "That king is protected this turn." };
      }
    }
  }

  if(target && target.kind === "piece"){
    next.quietus[target.color][target.type] += 1;
    if(target.type === "K"){ next.kingOnBoard[target.color] = false; capturedKing = target.color; }
  }

  to.occupant = from.occupant;
  from.occupant = null;

  next.lastMove = { from: fromId, to: toId, by: (mover as Exclude<Occupant,null>).color };

  if(to.occupant && to.occupant.kind === "piece" && to.occupant.mustReturn){
    if(to.rank>=3 && to.rank<=6){
      to.occupant.mustReturn = false;
      to.occupant.returnByTurn = undefined;
    }
  }

  if(to.occupant && to.occupant.kind === "piece" && to.rank>=3 && to.rank<=6 && to.blueSymbol){
    const color = to.occupant.color;
    const current = to.occupant.type;
    const needed = to.blueSymbol;
    if(current !== needed && next.stock[color][needed] > 0){
      next.stock[color][current] = Math.min(INITIAL_COUNTS[current], next.stock[color][current] + 1);
      next.stock[color][needed] -= 1;
      to.occupant = { kind:"piece", color, type: needed, bornAtTurn: next.moveNumber };
      if(current === "K" && needed !== "K") next.kingOnBoard[color] = false;
      if(needed === "K"){ next.kingOnBoard[color] = true; next.kingProtectedUntil[color] = next.moveNumber + 1; }
    }
  }

  if(to.occupant && to.occupant.kind === "metamorph" && to.rank>=3 && to.rank<=6 && to.blueSymbol){
    const color = to.occupant.color;
    const needed = to.blueSymbol;
    if(next.stock[color][needed] > 0){
      next.stock[color][needed] -= 1;
      to.occupant = { kind: "piece", color, type: needed, bornAtTurn: next.moveNumber };
      if(needed === "K"){ next.kingOnBoard[color] = true; next.kingProtectedUntil[color] = next.moveNumber + 1; }
    }
  }

  if(to.occupant && to.occupant.kind === "piece" && to.occupant.type === "P"){
    if((to.occupant.color === "white" && to.rank === 1) || (to.occupant.color === "black" && to.rank === 8)){
      next.promotion = { square: to.id, color: to.occupant.color };
    }
  }

  next.turn = next.turn === "white" ? "black" : "white";
  next.moveNumber += 1;

  for(const sq of next.board){
    const o = sq.occupant;
    if(o && o.kind === "piece" && o.mustReturn && o.returnByTurn !== undefined){
      const justMoved: Color = next.turn === "white" ? "black" : "white";
      if(o.color === justMoved && next.moveNumber >= o.returnByTurn){
        if(!(sq.rank>=3 && sq.rank<=6)){
          if(o.type === "K") next.kingOnBoard[o.color] = false;
          sq.occupant = null; // disappears; not returned to chrysalis
        } else {
          o.mustReturn = false; o.returnByTurn = undefined;
        }
      }
    }
  }

  const { newGs } = applyAutoTransforms(next);
  newGs.selected = null;
  newGs.message = null;

  const lastMover: Color = newGs.turn === "white" ? "black" : "white";
  const win = detectWin(newGs, lastMover, capturedKing);
  if(win){ newGs.winner = win.winner; newGs.winReason = win.reason; newGs.message = `Winner: ${win.winner} (${win.reason})`; }
  return newGs;
}

const INITIAL_COUNTS: ChrysalisStock = { K:1, Q:1, R:2, B:2, N:2, P:8 };
function activeCounts(gs: GameState, color: Color): ChrysalisStock {
  const c: ChrysalisStock = { K:0, Q:0, R:0, B:0, N:0, P:0 };
  for(const sq of gs.board){
    const o = sq.occupant;
    if(o && o.kind === "piece" && o.color === color){ c[o.type] += 1; }
  }
  return c;
}
function promotionAvailable(gs: GameState, color: Color, t: PieceType){
  const act = activeCounts(gs, color)[t];
  const cap = INITIAL_COUNTS[t];
  return act < cap;
}

function applyPromotionChoice(state: GameState, type: PieceType): GameState {
  if(!state.promotion) return state;
  const { square, color } = state.promotion;
  const next = deepClone(state);
  const sq = next.board.find(s=>s.id===square)!;
  const need = type;
  if(!promotionAvailable(next, color, need)) return state;
  if(next.quietus[color][need] > 0){ next.quietus[color][need] -= 1; }
  const deadline = next.moveNumber + 1;
  sq.occupant = { kind:"piece", color, type: need, bornAtTurn: next.moveNumber, mustReturn: true, returnByTurn: deadline };
  if(need === "K"){ next.kingOnBoard[color] = true; next.kingProtectedUntil[color] = next.moveNumber + 1; }
  next.promotion = null;
  return applyAutoTransforms(next).newGs;
}

function isSquareAttacked(gs: GameState, f:number, r:number, by: Color): boolean {
  for(const sq of gs.board){
    const o = sq.occupant;
    if(!o || o.kind!=="piece" || o.color!==by) continue;
    const moves = legalMovesForPiece(gs, sq);
    if(moves.some(m=>m.f===f && m.r===r)) return true;
  }
  return false;
}

function findKingSquare(gs: GameState, color: Color): Square | null {
  for(const sq of gs.board){
    const o = sq.occupant;
    if(o && o.kind === "piece" && o.color===color && o.type==="K") return sq;
  }
  return null;
}

function anyPawnCanMove(gs: GameState, color: Color): boolean {
  for(const sq of gs.board){
    const o = sq.occupant;
    if(o && o.kind === "piece" && o.color===color && o.type==="P"){
      const ms = legalMovesForPiece(gs, sq);
      if(ms.length>0) return true;
    }
  }
  return false;
}

function anyMetamorphCanMove(gs: GameState, color: Color): boolean {
  for(const sq of gs.board){
    const o = sq.occupant;
    if(o && o.kind === "metamorph" && o.color===color){
      const ms = legalMovesForMetamorph(gs, sq);
      if(ms.length>0) return true;
    }
  }
  return false;
}

function hasAnyMetamorph(gs: GameState, color: Color): boolean {
  return gs.board.some(s=>s.occupant && s.occupant.kind==="metamorph" && s.occupant.color===color);
}
function hasAnyPawn(gs: GameState, color: Color): boolean {
  return gs.board.some(s=>s.occupant && s.occupant.kind==="piece" && s.occupant.color===color && s.occupant.type==="P");
}

function detectWin(gs: GameState, lastMover: Color, capturedKing: Color | null): {winner: Color; reason: string} | null {
  const opponent: Color = gs.turn; // after last move, it's opponent's turn

  if(capturedKing){
    return { winner: lastMover, reason: "king captured" };
  }

  if(gs.kingOnBoard[opponent]){
    const ksq = findKingSquare(gs, opponent);
    if(ksq){
      const inCheck = isSquareAttacked(gs, ksq.file, ksq.rank, lastMover);
      if(inCheck){
        const occ = ksq.occupant as Extract<Occupant,{kind:"piece"}>;
        const kingMoves = legalMovesForPiece(gs, ksq).filter(m=> occ.type === "K");
        const safeKingMoves = kingMoves.filter(m=> !isSquareAttacked(gs, m.f, m.r, lastMover));
        if(safeKingMoves.length===0){
          return { winner: lastMover, reason: "checkmate" };
        }
      }
    }
  }

  for(const color of ["white","black"] as Color[]){
    if(!gs.kingOnBoard[color]){
      const noPawns = !hasAnyPawn(gs, color);
      const pawnsStuck = !noPawns && !anyPawnCanMove(gs, color);
      const noMorphs = !hasAnyMetamorph(gs, color);
      const morphsStuck = !noMorphs && !anyMetamorphCanMove(gs, color);
      if( (noPawns || pawnsStuck) && (noMorphs || morphsStuck) ){
        const winner: Color = color === "white" ? "black" : "white";
        return { winner, reason: "no king + no mobile pawns/metamorphs" };
      }
    }
  }
  return null;
}

const pieceGlyph = (t: PieceType) => (
  t === "K" ? "♚" :
  t === "Q" ? "♛" :
  t === "R" ? "♜" :
  t === "B" ? "♝" :
  t === "N" ? "♞" :
  "♟"
);

function BlueSymbol({type}:{type:PieceType}){
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100">
      <text x="50" y="78" textAnchor="middle" fontSize="84" fill="none" stroke="#7DB1BF" strokeWidth="3" fontFamily="'Noto Chess', 'DejaVu Sans', serif">
        {pieceGlyph(type)}
      </text>
    </svg>
  );
}

function Piece({occ}:{occ: Extract<Occupant,{kind:"piece"}>}){
  const color = occ.color === "white" ? "#f5f5f5" : "#1a1a1a";
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{zIndex:2}}>
      <div className="w-[80%] h-[80%] flex items-center justify-center" draggable>
        <svg viewBox="0 0 100 100" className="w-full h-full" style={{filter:"drop-shadow(0 2px 2px rgba(0,0,0,0.3))"}}>
          <text x="50" y="70" textAnchor="middle" fontSize="92" fill={color} stroke={color} strokeWidth="1" fontFamily="'Noto Chess', 'DejaVu Sans', serif">
            {pieceGlyph(occ.type)}
          </text>
        </svg>
      </div>
    </div>
  );
}

function Metamorph({color}:{color:Color}){
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{zIndex:1}}>
      <div className="w-[72%] h-[72%] rounded-full border border-black/60" style={{ background: color==="white"?"radial-gradient(circle at 30% 30%, #ffffff, #d9d9d9)":"radial-gradient(circle at 30% 30%, #444, #111)" }} />
    </div>
  );
}

function woodColor(file:number, rank:number){
  const beech = "#E6CBA8"; // light
  const oak   = "#8C6B3E"; // dark
  const isDark = (file + rank) % 2 === 1;
  return isDark ? oak : beech;
}

export default function App(){
  const [gs, setGs] = useState<GameState>(()=>initialGame());
  const dragFrom = useRef<SquareId|null>(null);
  const dragGhostRef = useRef<HTMLDivElement|null>(null);
  const testsOnce = useRef(false);

  function newGame(){ setGs(initialGame()); }

  useEffect(()=>{
    if(!testsOnce.current){
      try { runSelfTests(); } catch (e){ console.warn("Self-tests threw:", e); }
      testsOnce.current = true;
    }
  }, []);

  useEffect(()=>{
    if(gs.winner) return;
    if(gs.ai.mode !== 'cpu') return;
    if(gs.turn !== gs.ai.cpuPlays) return;

    // AI handles its own promotion
    if(gs.promotion && gs.promotion.color === gs.ai.cpuPlays){
      setGs(prev=> applyPromotionChoice(prev, aiBestPromotion(prev, prev.ai.cpuPlays)));
      return;
    }
    const id = setTimeout(()=>{
      setGs(prev=> pickAiMove(prev));
    }, 150);
    return ()=> clearTimeout(id);
  }, [gs.turn, gs.ai.mode, gs.ai.cpuPlays, gs.ai.level, gs.promotion, gs.winner]);

  function aiBestPromotion(state: GameState, color: Color): PieceType{
    const order: PieceType[] = ['Q','R','B','N','K'];
    for(const t of order){ if(promotionAvailable(state, color, t)) return t; }
    return 'Q';
  }

  function prepareDragImage(e: React.DragEvent, occ: Exclude<Occupant,null>){
    if(!dragGhostRef.current){
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.top = '-9999px';
      host.style.left = '-9999px';
      host.style.pointerEvents = 'none';
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

    if(occ.kind === "piece"){
      const color = occ.color === "white" ? "#f5f5f5" : "#1a1a1a";
      ghost.innerHTML = `
        <svg viewBox="0 0 100 100" width="64" height="64" style="filter: drop-shadow(0 2px 2px rgba(0,0,0,.35))">
          <text x="50" y="70" text-anchor="middle" font-size="92" fill="${color}" stroke="${color}" stroke-width="1" font-family="'Noto Chess', 'DejaVu Sans', serif">
            ${pieceGlyph(occ.type)}
          </text>
        </svg>`;
    } else {
      const fill = occ.color === "white" ? "radial-gradient(circle at 30% 30%, #ffffff, #d9d9d9)" : "radial-gradient(circle at 30% 30%, #444, #111)";
      ghost.innerHTML = `<div style="width:56px;height:56px;border-radius:9999px;border:1px solid rgba(0,0,0,.6);background:${fill}"></div>`;
    }
    host.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 32, 32);
  }

  function onDragStart(e: React.DragEvent, sq: Square){
    if(gs.winner){ e.preventDefault(); return; }
    if(gs.ai.mode==='cpu' && gs.turn===gs.ai.cpuPlays){ e.preventDefault(); return; }
    if(!sq.occupant) { e.preventDefault(); return; }
    const color = sq.occupant.kind==="metamorph"? sq.occupant.color : sq.occupant.color;
    if(color !== gs.turn){ e.preventDefault(); return; }
    dragFrom.current = sq.id;
    e.dataTransfer.setData("text/plain", sq.id);
    prepareDragImage(e, sq.occupant as Exclude<Occupant,null>);
  }
  function onDragOver(e: React.DragEvent, _sq: Square){ e.preventDefault(); }
  function onDrop(e: React.DragEvent, sq: Square){
    e.preventDefault();
    if(gs.ai.mode==='cpu' && gs.turn===gs.ai.cpuPlays) return;
    const fromId = dragFrom.current || (e.dataTransfer.getData("text/plain") as SquareId);
    if(!fromId) return;
    dragFrom.current = null;
    setGs(prev => performMove(prev, fromId, sq.id));
  }

  function clickMove(target: Square){
    if(gs.winner) return;
    if(gs.ai.mode==='cpu' && gs.turn===gs.ai.cpuPlays) return;
    if(!gs.selected){
      if(!target.occupant) return;
      const color = target.occupant.kind==="metamorph" ? target.occupant.color : target.occupant.color;
      if(color !== gs.turn) return;
      setGs({...gs, selected: target.id});
      return;
    }
    setGs(performMove(gs, gs.selected as SquareId, target.id));
  }

  function handlePromotion(type: PieceType){
    if(!gs.promotion) return;
    const { square, color } = gs.promotion;
    const next = deepClone(gs);
    const sq = next.board.find(s=>s.id===square)!;
    const need = type;
    if(!promotionAvailable(next, color, need)) { next.message = "You can't promote to that piece right now."; setGs(next); return; }
    if(next.quietus[color][need] > 0){ next.quietus[color][need] -= 1; }
    const deadline = next.moveNumber + 1;
    sq.occupant = { kind:"piece", color, type: need, bornAtTurn: next.moveNumber, mustReturn: true, returnByTurn: deadline };
    if(need === "K"){ next.kingOnBoard[color] = true; next.kingProtectedUntil[color] = next.moveNumber + 1; }
    next.promotion = null;
    const { newGs } = applyAutoTransforms(next);
    setGs(newGs);
  }

  const whiteStock = gs.stock.white; const blackStock = gs.stock.black;

  return (
    <div className="min-h-screen w-full flex items-start justify-center gap-4 bg-neutral-900 p-4 text-neutral-100">
      {/* White Chrysalis */}
      <div className="flex flex-col gap-3 w-56 shrink-0">
        <h2 className="text-lg font-semibold">White chrysalis</h2>
        <StockView stock={whiteStock} color="white" />
        <button onClick={newGame} className="mt-2 px-3 py-2 rounded-2xl bg-neutral-200 text-neutral-900 font-semibold shadow">New Game</button>
        <div className="text-sm opacity-80">Turn: <span className="font-bold capitalize">{gs.turn}</span></div>
        {gs.message && <div className="text-xs bg-yellow-500/20 text-yellow-200 px-2 py-1 rounded">{gs.message}</div>}

        {/* Controls */}
        <div className="mt-2 p-3 rounded-xl bg-neutral-800/70 border border-neutral-700 space-y-2">
          <div className="font-semibold text-sm">Computer opponent</div>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Mode</span>
            <select className="bg-neutral-900 border border-neutral-600 rounded px-2 py-1" value={gs.ai.mode}
                    onChange={e=>setGs({...gs, ai:{...gs.ai, mode: e.target.value as any}})}>
              <option value="human">Human vs Human</option>
              <option value="cpu">Human vs Computer</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Computer plays</span>
            <select className="bg-neutral-900 border border-neutral-600 rounded px-2 py-1" value={gs.ai.cpuPlays}
                    onChange={e=>setGs({...gs, ai:{...gs.ai, cpuPlays: e.target.value as Color}})}>
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Level</span>
            <select className="bg-neutral-900 border border-neutral-600 rounded px-2 py-1" value={gs.ai.level}
                    onChange={e=>setGs({...gs, ai:{...gs.ai, level: e.target.value as any}})}>
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
          </label>
        </div>
      </div>

      {/* Board */}
      <div className="grid grid-cols-8 grid-rows-8 select-none rounded-xl overflow-hidden shadow-2xl" style={{border:"4px solid #3b2f2f"}}>
        {RANKS.map(r=>FILES.map((_,f)=>{
          const sq = gs.board.find(s=>s.file===f && s.rank===r)!;
          const isSel = gs.selected===sq.id;
          const lm = gs.lastMove;
          const showAiHighlight = gs.ai.mode==='cpu' && lm && lm.by===gs.ai.cpuPlays;
          const isFrom = showAiHighlight && lm!.from===sq.id;
          const isTo = showAiHighlight && lm!.to===sq.id;
          return (
            <div key={sq.id}
                 onClick={()=>clickMove(sq)}
                 onDragOver={(e)=>onDragOver(e,sq)}
                 onDrop={(e)=>onDrop(e,sq)}
                 className={`relative w-20 h-20 ${isSel?"outline outline-4 outline-emerald-400/80":""}`}
                 style={{ background: woodSquareBg(f,r) }}>
              {isFrom && <div className="absolute inset-1 rounded-lg ring-4 ring-yellow-400/70 pointer-events-none" />}
              {isTo && <div className="absolute inset-1 rounded-lg ring-4 ring-green-400/70 pointer-events-none" />}
              {sq.blueSymbol && (r>=3 && r<=6) && !(sq.occupant?.kind === "piece") && <BlueSymbol type={sq.blueSymbol} />}

              {sq.occupant?.kind === "metamorph" && <div draggable onDragStart={(e)=>onDragStart(e,sq)}><Metamorph color={sq.occupant.color} /></div>}
              {sq.occupant?.kind === "piece" && <div draggable onDragStart={(e)=>onDragStart(e,sq)}><Piece occ={sq.occupant} /></div>}
            </div>
          );
        }))}
      </div>

      {/* Black Chrysalis */}
      <div className="flex flex-col gap-3 w-48 shrink-0 items-end">
        <h2 className="text-lg font-semibold">Black chrysalis</h2>
        <StockView stock={blackStock} color="black" align="right" />
      </div>

      {/* Quietus bar */}
      <div className="fixed left-4 right-4 bottom-4 bg-neutral-800/90 backdrop-blur border border-neutral-700 rounded-2xl p-3 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="font-semibold tracking-wide">Quietus</div>
          <div className="text-xs opacity-70">Captured pieces · promotions revive from here if available</div>
        </div>
        {gs.winner && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 font-semibold">
            Winner: <span className="capitalize">{gs.winner}</span> · {gs.winReason}
          </div>
        )}
        <div className="mt-2 grid grid-cols-2 gap-3">
          <QuietusRow label="White" color="white" counts={gs.quietus.white} />
          <QuietusRow label="Black" color="black" counts={gs.quietus.black} align="right" />
        </div>
      </div>

      {/* Promotion modal */}
      {gs.promotion && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-neutral-800 border border-neutral-700 p-4 rounded-xl w-[420px]">
            <div className="text-lg font-semibold mb-2">Promote pawn</div>
            <div className="grid grid-cols-5 gap-2">
              {["Q","R","B","N","K"].map(t=> (
                <button key={t} className="p-3 rounded-xl bg-neutral-200 text-neutral-900 disabled:opacity-40"
                        disabled={!promotionAvailable(gs, gs.promotion!.color, t as PieceType)}
                        onClick={()=>handlePromotion(t as PieceType)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="mt-3 text-sm opacity-80">Choose a piece available under your caps. If available in Quietus, it will be taken from there.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function woodSquareBg(file:number, rank:number){
  const base = woodColor(file, rank);
  return `linear-gradient(135deg, ${shade(base,8)} 0%, ${base} 55%, ${shade(base,-6)} 100%)`;
}

function shade(hex:string, delta:number){
  const n = parseInt(hex.slice(1),16);
  let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  const s=(x:number)=> Math.max(0, Math.min(255, x + Math.round(255*delta/100)));
  r=s(r); g=s(g); b=s(b);
  return `#${((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}`;
}

function ChrysalisGlyph({type,color}:{type:PieceType;color:Color}){
  const isBlack = color === "black";
  const fill = isBlack ? "#111111" : "#f7f7f7";
  const stroke = isBlack ? "#f0f0f0" : "#0a0a0a";
  const strokeWidth = isBlack ? 2.5 : 1.5;
  return (
    <div className="w-8 h-8 rounded-lg bg-neutral-800 border border-neutral-600 flex items-center justify-center shadow-sm">
      <svg viewBox="0 0 100 100" className="w-[90%] h-[90%]">
        <text x="50" y="70" textAnchor="middle" fontSize="92" fill={fill} stroke={stroke} strokeWidth={strokeWidth} paintOrder="stroke" fontFamily="'Noto Chess', 'DejaVu Sans', serif">
          {pieceGlyph(type)}
        </text>
      </svg>
    </div>
  );
}

function QuietusRow({label,color,counts,align}:{label:string;color:Color;counts:ChrysalisStock;align?:"left"|"right"}){
  const order: PieceType[] = ["K","Q","R","B","N","P"];
  return (
    <div className={`flex ${align==="right"?"justify-end":"justify-start"} items-center gap-2 flex-wrap`}>
      <span className="text-sm mr-2 opacity-80 w-12">{label}</span>
      {order.flatMap(t => Array.from({length: counts[t]}).map((_,i)=> (
        <ChrysalisGlyph key={`${label}-${t}-${i}`} type={t} color={color} />
      )))}
    </div>
  );
}

function StockView({stock,color,align}:{stock:ChrysalisStock;color:Color;align?:"left"|"right"}){
  const order: PieceType[] = ["K","Q","R","B","N","P"];
  return (
    <div className={`flex flex-col gap-3 ${align==="right"?"items-end":"items-start"}`}>
      {order.map(t=> (
        <div key={t} className={`flex gap-2 flex-wrap ${align==="right"?"justify-end":"justify-start"}`} aria-label={`${color} ${t} in chrysalis`}>
          {Array.from({length: stock[t]}).map((_,i)=> (
            <ChrysalisGlyph key={i} type={t} color={color} />
          ))}
        </div>
      ))}
    </div>
  );
}

function kingInCheck(gs: GameState, color: Color): boolean {
  if(!gs.kingOnBoard[color]) return false;
  const ksq = findKingSquare(gs, color);
  if(!ksq) return false;
  const attacker = color === 'white' ? 'black' : 'white';
  return isSquareAttacked(gs, ksq.file, ksq.rank, attacker);
}

function generateMoves(gs: GameState, color: Color): {from: SquareId; to: SquareId; next: GameState}[] {
  const candidates: {from: SquareId; to: SquareId; next: GameState}[] = [];
  const base = deepClone(gs);
  base.turn = color;
  for(const sq of base.board){
    const o = sq.occupant;
    if(!o) continue;
    if(o.kind === 'metamorph' && o.color === color){
      const ms = legalMovesForMetamorph(base, sq);
      for(const m of ms){
        const n = performMove(base, sq.id, idFrom(m.f, m.r));
        const n2 = (n.promotion && n.promotion.color===color) ? aiResolvePromotion(n, color) : n;
        if(!n2.message) candidates.push({from: sq.id, to: idFrom(m.f,m.r), next: n2});
      }
    } else if (o.kind === 'piece' && o.color === color){
      const ms = legalMovesForPiece(base, sq);
      for(const m of ms){
        const n = performMove(base, sq.id, idFrom(m.f, m.r));
        const n2 = (n.promotion && n.promotion.color===color) ? aiResolvePromotion(n, color) : n;
        if(!n2.message) candidates.push({from: sq.id, to: idFrom(m.f,m.r), next: n2});
      }
    }
  }

  const safe = candidates.filter(mv => !kingInCheck(mv.next, color));
  if(kingInCheck(gs, color)){
    return safe;
  }
  return safe.length ? safe : candidates;
}

function aiResolvePromotion(state: GameState, color: Color): GameState {
  const pref: PieceType[] = ['Q','R','B','N','K'];
  for(const t of pref){
    if(promotionAvailable(state, color, t)){
      return applyPromotionChoice(state, t);
    }
  }
  return state;
}

function evaluate(gs: GameState, forColor: Color): number {
  if(gs.winner){ return gs.winner===forColor ? 1e9 : -1e9; }
  const val: Record<PieceType, number> = { K: 5000, Q: 900, R: 500, B: 330, N: 320, P: 100 };
  let score = 0;
  for(const sq of gs.board){
    const o = sq.occupant;
    if(o && o.kind==='piece'){
      const s = val[o.type];
      score += (o.color===forColor? +s : -s);
      if(sq.rank>=3 && sq.rank<=6) score += (o.color===forColor? 4 : -4);
    }
  }
  const myMoves = generateMoves(gs, forColor).length;
  const oppMoves = generateMoves(gs, forColor==='white'?'black':'white').length;
  score += (myMoves - oppMoves) * 0.5;
  return score;
}

function pickAiMove(gs: GameState): GameState {
  const { ai } = gs;
  const color = ai.cpuPlays;
  const moves = generateMoves(gs, color);
  if(moves.length===0) return gs;

  if(ai.level === 'Easy'){
    const sorted = moves.slice().sort(()=>Math.random()-0.5);
    return sorted[0].next;
  }

  if(ai.level === 'Medium'){
    let best = -Infinity, bestN = moves[0].next;
    for(const m of moves){
      const s = evaluate(m.next, color);
      if(s > best){ best = s; bestN = m.next; }
    }
    return bestN;
  }

  function minimax(state: GameState, depth: number, alpha: number, beta: number, maximizing: boolean, maximizingColor: Color): number {
    if(depth===0 || state.winner) return evaluate(state, maximizingColor);
    const side: Color = maximizing ? maximizingColor : (maximizingColor==='white'?'black':'white');
    const list = generateMoves(state, side);
    if(list.length===0) return evaluate(state, maximizingColor);
    if(maximizing){
      let val = -Infinity;
      for(const mv of list){
        val = Math.max(val, minimax(mv.next, depth-1, alpha, beta, false, maximizingColor));
        alpha = Math.max(alpha, val); if(beta <= alpha) break;
      }
      return val;
    } else {
      let val = Infinity;
      for(const mv of list){
        val = Math.min(val, minimax(mv.next, depth-1, alpha, beta, true, maximizingColor));
        beta = Math.min(beta, val); if(beta <= alpha) break;
      }
      return val;
    }
  }
  let bestScore = -Infinity; let bestNext = moves[0].next;
  for(const mv of moves){
    const sc = minimax(mv.next, 1, -Infinity, Infinity, false, color);
    if(sc > bestScore){ bestScore = sc; bestNext = mv.next; }
  }
  return bestNext;
}

/** tiny no-op to avoid ReferenceError from the useEffect self-test call */
function runSelfTests(){ /* intentionally empty */ }
