import React, { useEffect, useRef, useState } from "react";
import type { GameState, SquareId, Square, Occupant, PieceType, Color, ChrysalisStock } from "./engine";
import {
  initialGame,
  performMove,

  // UI helpers/constants used in App.tsx:
  pieceGlyph,
  GLYPH,
  RANKS,
  woodSquareBg,

  // things used in handlePromotion + self-tests:
  deepClone,
  applyAutoTransforms,
  stalemateOutcome,
  findKingSquare,
  isSquareAttacked,
  promotionAvailable,
  runSelfTests,
} from "./engine";




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

const BlueSymbol = ({ type, flip }: { type: PieceType; flip?: boolean }) => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none"
    viewBox="0 0 100 100"
    style={
      flip
        ? { transform: "rotate(180deg)", transformOrigin: "50% 50%" }
        : undefined
    }
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


const Piece = ({
  occ,
  flip,
}: {
  occ: Extract<Occupant, { kind: "piece" }>;
  flip?: boolean;
}) => {
  const color = occ.color === "white" ? "#f5f5f5" : "#1a1a1a";
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 2 }}>
      <div className="w-[80%] h-[80%] flex items-center justify-center" draggable>
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          style={{
            filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.3))",
            transform: flip ? "rotate(180deg)" : undefined,
            transformOrigin: "50% 50%",
          }}
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
  const aiWorkerRef = useRef<Worker | null>(null);
const aiThinkIdRef = useRef(0);
  const [gs, setGs] = useState<GameState>(() => initialGame());
  const dragFrom = useRef<SquareId | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const testsOnce = useRef(false);
  const [showRules, setShowRules] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const hvhFlipRank = (rank: number) =>
  gs.ai.mode === "human" &&
  ((flipped && (rank === 5 || rank === 6)) || (!flipped && (rank === 3 || rank === 4)));
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
  aiWorkerRef.current = new Worker(new URL("./ai.worker.ts", import.meta.url), {
    type: "module",
  });

  return () => {
    aiWorkerRef.current?.terminate();
    aiWorkerRef.current = null;
  };
}, []);


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
  // If *any* promotion dialog is open, don't let the CPU move yet.
  if (gs.promotion) return;

  if (gs.winReason || gs.ai.mode !== "cpu" || gs.turn !== gs.ai.cpuPlays) return;

  const w = aiWorkerRef.current;
  if (!w) return;

  const myId = ++aiThinkIdRef.current;

  const onMessage = (e: MessageEvent<any>) => {
    const msg = e.data;
    if (!msg || msg.id !== myId) return;

    if (msg.type === "RESULT") {
      setGs(msg.gs as GameState);
    } else if (msg.type === "ERROR") {
      console.error("AI worker error:", msg.error);
      setGs((prev) => ({ ...prev, message: "AI error (see console)" }));
    }

    w.removeEventListener("message", onMessage);
  };

  w.addEventListener("message", onMessage);

  const t = window.setTimeout(() => {
    w.postMessage({ type: "THINK", id: myId, gs });
  }, 150);

  return () => {
    window.clearTimeout(t);
    w.removeEventListener("message", onMessage);
  };
}, [gs.turn, gs.ai.mode, gs.ai.cpuPlays, gs.ai.level, gs.promotion, gs.winReason, gs]);



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
     if (gameOver) return;
    if (gs.ai.mode === "cpu" && gs.turn === gs.ai.cpuPlays) return;
    const fromId = dragFrom.current || (e.dataTransfer.getData("text/plain") as SquareId);
    if (!fromId) return;
    dragFrom.current = null;
    setGs((prev) => performMove(prev, fromId, sq.id));
  };

 const clickMove = (sq: Square) => {
  if (gameOver || (gs.ai.mode === "cpu" && gs.turn === gs.ai.cpuPlays)) return;


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
setGs(() => {
  let promoted = applyAutoTransforms(next).newGs;

  // ✅ STALEMATE CHECK (promotion does not run performMove's stalemate logic)
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
});  };



  const whiteStock = gs.stock.white;
  const blackStock = gs.stock.black;

  const rankOrder = flipped ? [...RANKS].slice().reverse() : RANKS;
  const fileOrder = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const gameOver = gs.winReason !== null;
const isCpuThinking =
  gs.ai.mode === "cpu" &&
  gs.turn === gs.ai.cpuPlays &&
  !gs.winReason &&
  !(gs.promotion && gs.promotion.color !== gs.ai.cpuPlays);
  
useEffect(() => {
  if (isCpuThinking) {
    setShowThinking(true);
  } else {
    const t = window.setTimeout(() => setShowThinking(false), 150);
    return () => window.clearTimeout(t);
  }
}, [isCpuThinking]);

  
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
      {showThinking && (
        <div className="flex items-center gap-1 text-[10px] tracking-[0.18em] text-white">
          <img
  src="/cover-bmac.png"
  alt="CPU thinking"
  className="w-4 h-4 object-contain rounded-full shadow animate-pulse"
  style={{
    filter: "none",
    colorScheme: "light",
  }}
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
                 className="bg-neutral-900 border border-neutral-600 rounded px-2 py-1 text-sm text-left"
                    style={{ textAlignLast: "right" }}

                value={gs.ai.level}
                onChange={(e) => setGs({ ...gs, ai: { ...gs.ai, level: e.target.value as any } })}
              >
                <option >Easy</option>
                <option >Medium</option>
                <option >Hard</option>
                <option>Master</option>
              </select>
            </label>
          </div>
        </div>

{/* Mobile-only top message bar (human vs human; readable from the top side) */}
{gs.ai.mode === "human" && (
  <div className="sm:hidden flex justify-center mb-2">
    <div className="w-full max-w-[min(90vw,40rem)]">
      <button
        className={`w-full px-3 py-2 rounded-2xl text-[11px] text-center border
          ${
            gs.message
              ? "bg-[#83b2be] text-black border-neutral-700"
              : "bg-neutral-800 text-neutral-300 border-neutral-700"
          }`}
        disabled
      >
        {/* Rotate the text 180° so the TOP-side player can read it */}
        <div className="rotate-180">
          {gs.message ? (
            <>
              {gs.message} ({gs.turn} turn)
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
)}




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
  <BlueSymbol type={sq.blueSymbol} flip={hvhFlipRank(r)} />
)}

                    {sq.occupant?.kind === "metamorph" && (
                      <div draggable onDragStart={(e) => onDragStart(e, sq)}>
                        <Metamorph color={sq.occupant.color} />
                      </div>
                    )}

                    {sq.occupant?.kind === "piece" && (
                      <div draggable onDragStart={(e) => onDragStart(e, sq)}>
                        <Piece
  occ={sq.occupant}
  flip={hvhFlipRank(r) && !!sq.blueSymbol && r >= 3 && r <= 6}
/>
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
      {gs.message} ({gs.turn} turn)
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
                game appeared as a result of sporadic contemplation assisted by a physical prototype (taken out in early afternoons). First published on 19th of October 2025.
                
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
                *Special thanks to H.G.Muller who dialectically helped refining some end game rules - especially winning by three-fold repetition, and Theodore De Marville for his quick critical thinking.
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
    {showThinking && (
      <div className="flex items-center text-[10px] tracking-[0.18em] text-white">
       <img
  src="/cover-bmac.png"
  alt="CPU thinking"
  className="w-4 h-4 object-contain rounded-full shadow animate-pulse"
  style={{
    filter: "none",
    colorScheme: "light",
  }}
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
              <option value="cpu">Human vs Engine</option>
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
            <span min-w-0>Level</span>
            <select
              className="bg-neutral-900 border border-neutral-600 rounded px-2 py-1 text-sm text-left"
              style={{ textAlignLast: "right" }}
              value={gs.ai.level}
              onChange={(e) => setGs({ ...gs, ai: { ...gs.ai, level: e.target.value as any } })}
            >
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
              <option>Master</option>
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

{gs.winReason && (
  <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 font-semibold text-sm">
    <span>
      {gs.winner === null ? "Draw" : "Winner:"}
    </span>{" "}
    {gs.winner !== null && <span className="capitalize">{gs.winner}</span>}
    <span> · {gs.winReason}</span>
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
                First published on 19th of October 2025.
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
              <p className="mt-4 opacity-90">
                *Special thanks to H.G.Muller who dialectically helped refining some end game rules - especially winning by three-fold repetition, and Theodore De Marville for his quick critical thinking.
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
