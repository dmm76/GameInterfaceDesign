import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type CockpitState = "STANDBY" | "VALIDATING" | "READY" | "ACTIVE" | "PAUSED" | "FAULT";

interface CarState {
  speed: number;        // km/h
  rpm: number;
  gear: number;         // 1–8
  steerAngle: number;   // -1 to 1
  throttle: number;     // 0–1
  brake: number;        // 0–1
  lapTime: number;
  bestLap: number;
  lapCount: number;
  sector: number;
  sectorTime: number;
  gForce: number;
  tyreTemp: number;
  fuel: number;
  sessionTime: number;
  distance: number;
  wheelSpin: boolean;
  drs: boolean;
  pitLimiter: boolean;
}

interface Keys {
  up: boolean; down: boolean; left: boolean; right: boolean;
  shift: boolean; ctrl: boolean; space: boolean; d: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const RPM_IDLE = 850;
const RPM_MAX  = 15000;
const RPM_SHIFT_UP   = 13200;
const RPM_SHIFT_DOWN = 5500;
const GEAR_RATIOS = [0, 3.6, 2.6, 1.95, 1.52, 1.22, 1.0, 0.85, 0.75];
// top speed (km/h) reachable in each gear — index 1..8
const GEAR_TOP_SPEED = [0, 65, 105, 150, 195, 240, 285, 315, 340];

function formatLap(s: number) {
  if (s === 0) return "--:--.---";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toFixed(3).padStart(6, "0")}`;
}

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function safe(v: number, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

// ── SVG Steering Wheel ───────────────────────────────────────────────────────

function SteeringWheel({ angle, rpm, gear, speed, drs, pitLimiter }: { angle: number; rpm: number; gear: number; speed: number; drs: boolean; pitLimiter: boolean }) {
  const rot = angle * 270; // max ±270°
  const total = 12;
  const lit = Math.round(clamp(rpm / RPM_MAX, 0, 1) * total);
  const ledColor = (i: number) => (i >= 10 ? "#ff00ff" : i >= 7 ? "#e8230a" : i >= 4 ? "#f59e0b" : "#22c55e");

  // small round push-button
  const Btn = ({ x, y, c, label }: { x: number; y: number; c: string; label?: string }) => (
    <g>
      <circle cx={x} cy={y} r="9" fill="#0a0a0c" stroke="#333" strokeWidth="1.5" />
      <circle cx={x} cy={y} r="6.5" fill={c} />
      <circle cx={x - 2} cy={y - 2} r="2" fill="rgba(255,255,255,0.35)" />
      {label && <text x={x} y={y + 21} textAnchor="middle" fill="#556170" fontSize="7" fontFamily="Rajdhani,sans-serif" fontWeight="600">{label}</text>}
    </g>
  );

  // rotary dial
  const Rotary = ({ x, y, label }: { x: number; y: number; label: string }) => (
    <g>
      <circle cx={x} cy={y} r="20" fill="#141414" stroke="#2a2a2a" strokeWidth="2" />
      <circle cx={x} cy={y} r="15" fill="#0d0d0d" stroke="#333" strokeWidth="1" />
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        return <circle key={i} cx={x + Math.cos(a) * 17} cy={y + Math.sin(a) * 17} r="1.1" fill="#3a4657" />;
      })}
      <line x1={x} y1={y} x2={x} y2={y - 13} stroke="#e8230a" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(40 ${x} ${y})`} />
      <circle cx={x} cy={y} r="4" fill="#1a1a1a" />
      <text x={x} y={y + 32} textAnchor="middle" fill="#556170" fontSize="7.5" fontFamily="Rajdhani,sans-serif" fontWeight="700" letterSpacing="1">{label}</text>
    </g>
  );

  return (
    <div className="flex items-center justify-center" style={{ perspective: 850 }}>
      <svg
        width="290" height="255"
        viewBox="-170 -150 340 300"
        style={{
          transform: `rotateX(20deg) rotate(${rot}deg)`,
          transition: "transform 60ms linear",
          filter: "drop-shadow(0 12px 26px rgba(0,0,0,0.65)) drop-shadow(0 0 26px rgba(232,35,10,0.16))",
        }}
      >
        {/* ── PADDLE SHIFTERS (behind, carbon) ── */}
        <path d="M -128,44 L -150,52 L -150,92 L -120,80 Z" fill="#15181d" stroke="#2a2f38" strokeWidth="1.5" />
        <path d="M 128,44 L 150,52 L 150,92 L 120,80 Z" fill="#15181d" stroke="#2a2f38" strokeWidth="1.5" />
        <text x="-135" y="72" textAnchor="middle" fill="#556170" fontSize="8" fontFamily="Rajdhani,sans-serif" fontWeight="700">▼</text>
        <text x="135" y="72" textAnchor="middle" fill="#556170" fontSize="8" fontFamily="Rajdhani,sans-serif" fontWeight="700">▲</text>

        {/* ── CENTRAL CARBON BODY (rectangular F1 shape) ── */}
        <path
          d="M -74,-98 Q -78,-100 -74,-96 L 74,-98 Q 80,-98 80,-88 L 80,64 Q 80,80 64,86 L 40,96 Q 30,100 20,96 L -20,96 Q -30,100 -40,86 L -64,86 Q -80,80 -80,64 L -80,-88 Q -80,-98 -74,-98 Z"
          fill="#16181d" stroke="#2f3541" strokeWidth="2.5"
        />
        <path d="M -74,-96 L 74,-96 L 74,-70 L -74,-70 Z" fill="#0f1115" opacity="0.6" />

        {/* ── SIDE GRIPS (thick, angled) ── */}
        {([-1, 1] as const).map((s) => (
          <g key={s} transform={`translate(${s * 110}, 8) rotate(${s * 12})`}>
            <rect x="-26" y="-84" width="52" height="164" rx="24" fill="#1a1c21" stroke="#2f3541" strokeWidth="2.5" />
            <rect x="-19" y="-70" width="38" height="30" rx="10" fill="#0d0f13" />
            {/* red grip band */}
            <rect x="-26" y="-18" width="52" height="46" rx="14" fill="#e8230a" />
            <rect x="-26" y="-18" width="52" height="46" rx="14" fill="none" stroke="#a01606" strokeWidth="1.5" />
            {/* grip stitching */}
            {[-8, 4, 16].map((gy) => (
              <line key={gy} x1="-22" y1={gy} x2="22" y2={gy} stroke="#00000055" strokeWidth="1.5" strokeDasharray="2 3" />
            ))}
            {/* thumb button */}
            <circle cx="0" cy="52" r="9" fill="#0a0a0c" stroke="#333" strokeWidth="1.5" />
            <circle cx="0" cy="52" r="6" fill={s < 0 ? "#2563eb" : "#f59e0b"} />
          </g>
        ))}

        {/* ── LED SHIFT STRIP (top of panel) ── */}
        <rect x="-64" y="-90" width="128" height="16" rx="4" fill="#050608" stroke="#222" strokeWidth="1" />
        {Array.from({ length: total }, (_, i) => (
          <rect key={i} x={-60 + i * 10} y={-87} width="7" height="10" rx="1.5"
            fill={i < lit ? ledColor(i) : "#161a1f"}
            style={{ filter: i < lit ? `drop-shadow(0 0 3px ${ledColor(i)})` : "none" }} />
        ))}

        {/* ── CENTRAL LCD DISPLAY ── */}
        <rect x="-50" y="-66" width="100" height="52" rx="5" fill="#02100a" stroke="#0d3a24" strokeWidth="2" />
        <rect x="-50" y="-66" width="100" height="52" rx="5" fill="none" stroke="#000" strokeWidth="0.5" />
        <text x="-44" y="-52" fill="#2fd27a" fontSize="7" fontFamily="'JetBrains Mono',monospace" fontWeight="700" letterSpacing="1">SMART RACE</text>
        <text x="-8" y="-24" textAnchor="middle" fill="#3affa0" fontSize="30" fontFamily="'JetBrains Mono',monospace" fontWeight="700">{gear}</text>
        <text x="-8" y="-14" textAnchor="middle" fill="#0d6b3f" fontSize="6" fontFamily="Rajdhani,sans-serif" letterSpacing="2">GEAR</text>
        <text x="44" y="-46" textAnchor="end" fill="#e8eaed" fontSize="15" fontFamily="'JetBrains Mono',monospace" fontWeight="700">{Math.round(speed)}</text>
        <text x="44" y="-38" textAnchor="end" fill="#0d6b3f" fontSize="6" fontFamily="Rajdhani,sans-serif" letterSpacing="1">KM/H</text>
        {/* mini rpm bar in display */}
        <rect x="26" y="-28" width="20" height="4" rx="1" fill="#04241a" />
        <rect x="26" y="-28" width={clamp(rpm / RPM_MAX, 0, 1) * 20} height="4" rx="1" fill="#3affa0" />

        {/* ── BUTTON CLUSTER ── */}
        <Btn x={-30} y={2} c="#2563eb" label="RADIO" />
        <Btn x={0} y={2} c="#e8230a" label="OT" />
        <Btn x={30} y={2} c="#eab308" label="BOX" />

        {/* DRS + PIT (state-reactive) */}
        <g>
          <rect x="-46" y="24" width="40" height="20" rx="4" fill={drs ? "#22c55e" : "#0f1115"} stroke={drs ? "#22c55e" : "#333"} strokeWidth="1.5" />
          <text x="-26" y="38" textAnchor="middle" fill={drs ? "#04140a" : "#6b7684"} fontSize="9" fontFamily="Rajdhani,sans-serif" fontWeight="700" letterSpacing="1">DRS</text>
        </g>
        <g>
          <rect x="6" y="24" width="40" height="20" rx="4" fill={pitLimiter ? "#f59e0b" : "#0f1115"} stroke={pitLimiter ? "#f59e0b" : "#333"} strokeWidth="1.5" />
          <text x="26" y="38" textAnchor="middle" fill={pitLimiter ? "#140d02" : "#6b7684"} fontSize="9" fontFamily="Rajdhani,sans-serif" fontWeight="700" letterSpacing="1">PIT</text>
        </g>

        {/* ── ROTARY DIALS ── */}
        <Rotary x={-40} y={68} label="MIX" />
        <Rotary x={40} y={68} label="BB" />

        {/* center marker so straight-ahead is obvious */}
        <rect x="-2.5" y="-104" width="5" height="9" rx="1" fill="#e8230a" />
      </svg>
    </div>
  );
}

// ── RPM LED Bar (F1 style) ───────────────────────────────────────────────────

function RPMLEDs({ rpm }: { rpm: number }) {
  const total = 15;
  const lit = Math.round(clamp(rpm / RPM_MAX, 0, 1) * total);
  const colors = (i: number) => {
    if (i >= 13) return "#ff00ff"; // shift lights
    if (i >= 10) return "#e8230a"; // red
    if (i >= 6)  return "#f59e0b"; // yellow
    return "#22c55e";              // green
  };
  return (
    <div className="flex gap-1 justify-center">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="rounded-sm transition-all duration-30"
          style={{
            width: 18, height: i >= 13 ? 20 : 16,
            background: i < lit ? colors(i) : "#111",
            boxShadow: i < lit ? `0 0 8px ${colors(i)}` : "none",
            marginBottom: i >= 13 ? -2 : 0,
          }}
        />
      ))}
    </div>
  );
}

// ── Pedal Bars ───────────────────────────────────────────────────────────────

function PedalBar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1" style={{ width: 36 }}>
      <div
        className="w-full rounded-t relative overflow-hidden"
        style={{ height: 100, background: "#111" }}
      >
        <div
          className="absolute bottom-0 left-0 right-0 rounded-t transition-all duration-60"
          style={{ height: `${value * 100}%`, background: color, boxShadow: value > 0 ? `0 0 12px ${color}` : "none" }}
        />
      </div>
      <span className="font-mono text-xs font-bold" style={{ color, fontSize: 10 }}>{label}</span>
      <span className="font-mono text-xs" style={{ color: "#666", fontSize: 10 }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

// ── Mini Track Map ────────────────────────────────────────────────────────────

function TrackMap({ progress }: { progress: number }) {
  // Simplified Interlagos-ish shape
  const path = "M 80,20 Q 150,10 170,50 Q 190,90 160,110 Q 130,130 150,160 Q 170,190 140,210 Q 100,230 60,200 Q 20,170 30,130 Q 40,90 20,60 Q 10,30 80,20 Z";
  const perimeterApprox = 620;
  const offset = perimeterApprox * (1 - progress);

  return (
    <svg width="200" height="240" viewBox="0 0 200 240">
      <path d={path} fill="none" stroke="#1e2a38" strokeWidth="12" strokeLinejoin="round" />
      <path d={path} fill="none" stroke="#2a3a4a" strokeWidth="8" strokeLinejoin="round" />
      <path
        d={path}
        fill="none"
        stroke="#e8230a"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeDasharray={perimeterApprox}
        strokeDashoffset={offset}
      />
      {/* sector markers */}
      <circle cx="170" cy="80" r="4" fill="#f59e0b" />
      <circle cx="80" cy="210" r="4" fill="#f59e0b" />
      <text x="176" y="84" fill="#f59e0b" fontSize="8" fontFamily="Rajdhani,sans-serif">S2</text>
      <text x="86" y="214" fill="#f59e0b" fontSize="8" fontFamily="Rajdhani,sans-serif">S3</text>
      {/* start/finish */}
      <rect x="73" y="14" width="14" height="10" rx="1" fill="#22c55e" />
      <text x="95" y="22" fill="#22c55e" fontSize="8" fontFamily="Rajdhani,sans-serif">S/F</text>
      {/* circuit name */}
      <text x="100" y="125" textAnchor="middle" fill="#2a3a4a" fontSize="9" fontFamily="Rajdhani,sans-serif" fontWeight="700">INTERLAGOS</text>
    </svg>
  );
}

// ── Key Indicator ─────────────────────────────────────────────────────────────

function Key({ label, active, wide = false }: { label: string; active: boolean; wide?: boolean }) {
  return (
    <div
      className="flex items-center justify-center rounded font-mono font-bold select-none transition-all duration-60"
      style={{
        width: wide ? 56 : 28, height: 28,
        fontSize: 10,
        background: active ? "#e8230a" : "#111",
        color: active ? "#fff" : "#555",
        border: `1px solid ${active ? "#e8230a" : "#222"}`,
        boxShadow: active ? "0 0 8px rgba(232,35,10,0.6), 0 3px 0 #a00" : "0 3px 0 #000",
        transform: active ? "translateY(2px)" : "none",
      }}
    >
      {label}
    </div>
  );
}

// ── State overlay ─────────────────────────────────────────────────────────────

function StateOverlay({ state, step, onAction }: { state: CockpitState; step: number; onAction: (s: CockpitState) => void }) {
  if (state === "ACTIVE") return null;

  const configs: Record<Exclude<CockpitState, "ACTIVE">, { title: string; sub: string; btn?: string; next?: CockpitState; color: string }> = {
    STANDBY:    { title: "SMART RACE COCKPIT", sub: "Simulador Mecatrônico · SENAI 2026", btn: "ENTRAR NA CABINE", next: "VALIDATING", color: "#22c55e" },
    VALIDATING: { title: "VALIDANDO OCUPAÇÃO", sub: "Aguardando sensores de presença, cortina e porta…", color: "#f59e0b" },
    READY:      { title: "SISTEMA PRONTO", sub: "Todos os sensores confirmados. Pressione para iniciar.", btn: "LARGAR!", next: "ACTIVE", color: "#e8230a" },
    PAUSED:     { title: "SESSÃO PAUSADA", sub: "Jogo interrompido.", btn: "RETOMAR", next: "ACTIVE", color: "#fb923c" },
    FAULT:      { title: "FALHA DETECTADA", sub: "Verificar sensores e reiniciar o sistema.", btn: "RESET", next: "STANDBY", color: "#ef4444" },
  };

  const cfg = configs[state];

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6"
      style={{ background: "rgba(8,10,12,0.92)", backdropFilter: "blur(4px)" }}
    >
      <div className="text-center">
        <div
          className="font-display font-bold mb-2"
          style={{ fontSize: 42, color: cfg.color, textShadow: `0 0 40px ${cfg.color}66`, letterSpacing: 4 }}
        >
          {cfg.title}
        </div>
        <div className="font-body text-sm" style={{ color: "#64748b" }}>{cfg.sub}</div>
      </div>

      {state === "VALIDATING" && (
        <div className="flex gap-4">
          {[
            { label: "Cortina de luz" },
            { label: "Presença detectada" },
            { label: "Porta fechada" },
          ].map((s, i) => {
            const done = step >= i + 1;
            return (
              <div key={i} className="flex items-center gap-2 font-mono text-xs" style={{ color: done ? "#22c55e" : "#64748b" }}>
                <div className={`w-2 h-2 rounded-full ${done ? "" : "pulse"}`} style={{ background: done ? "#22c55e" : "#f59e0b" }} />
                {done ? "✓ " : ""}{s.label}
              </div>
            );
          })}
        </div>
      )}

      {cfg.btn && cfg.next && (
        <button
          onClick={() => onAction(cfg.next!)}
          className="font-display font-bold tracking-widest px-10 py-4 rounded transition-all duration-200"
          style={{
            fontSize: 18, color: "#fff", background: cfg.color,
            boxShadow: `0 0 30px ${cfg.color}55, 0 4px 0 rgba(0,0,0,0.5)`,
            border: "none",
          }}
        >
          {cfg.btn}
        </button>
      )}

      <div className="font-mono text-xs" style={{ color: "#2a3a4a" }}>
        SENAI · Mecatrônica · Prof. Aurimar · Douglas · Deni · Gabriela · Gabriel · Lucas · Marcio · Nicolas · Vitor
      </div>
    </div>
  );
}

// ── Realistic Cockpit Diagram with Sensor Markers ─────────────────────────────
// Top-view F1 chassis cutaway. The seven project sensors are marked at their
// physical positions (see Figura 5 do projeto). Each marker pulses and reports
// a live value derived from the state machine + telemetry.

type SensorKey = "pressao" | "temp" | "porta" | "cortina" | "gases" | "marcha" | "presenca";

interface SensorInfo {
  key: SensorKey;
  name: string;
  spec: string;      // short technical descriptor
  dx: number; dy: number;      // marker position on chassis
  lx: number; ly: number;      // label chip anchor
  side: "L" | "R";
}

// physical layout, matched to a top-down F1 cockpit (nose up, rear down)
const SENSORS: SensorInfo[] = [
  { key: "cortina",  name: "CORTINA DE LUZ", spec: "Feixe óptico · entrada", dx: 170, dy: 150, lx: 6,   ly: 96,  side: "L" },
  { key: "temp",     name: "TEMPERATURA",    spec: "NTC · cabine",          dx: 170, dy: 178, lx: 6,   ly: 168, side: "L" },
  { key: "porta",    name: "REED SWITCH",    spec: "Campo mag. · porta",    dx: 128, dy: 208, lx: 6,   ly: 244, side: "L" },
  { key: "pressao",  name: "PRESSÃO",        spec: "Força · volante",       dx: 170, dy: 200, lx: 258, ly: 96,  side: "R" },
  { key: "presenca", name: "PRESENÇA",       spec: "Ocupação · assento",    dx: 170, dy: 232, lx: 258, ly: 168, side: "R" },
  { key: "marcha",   name: "FOTOELÉTRICO",   spec: "Posição · câmbio",      dx: 212, dy: 216, lx: 258, ly: 240, side: "R" },
  { key: "gases",    name: "SENSOR DE GASES", spec: "Qual. ar · airbox",    dx: 170, dy: 270, lx: 258, ly: 312, side: "R" },
];

function sensorStatus(
  key: SensorKey,
  car: CarState,
  state: CockpitState,
  step: number,
): { value: string; color: string; on: boolean } {
  const active = state === "ACTIVE" || state === "PAUSED";
  const GREEN = "#22c55e", AMBER = "#f59e0b", GRAY = "#3a4657", RED = "#ef4444";

  switch (key) {
    // occupancy trio — validated sequentially during VALIDATING
    case "cortina":
      if (state === "VALIDATING") return step >= 1 ? { value: "PASSAGEM", color: GREEN, on: true } : { value: "ARMADA", color: AMBER, on: true };
      return active ? { value: "LIVRE", color: GREEN, on: true } : { value: "ARMADA", color: GRAY, on: false };
    case "presenca":
      if (state === "VALIDATING") return step >= 2 ? { value: "PILOTO", color: GREEN, on: true } : { value: "…", color: GRAY, on: false };
      return active ? { value: "PILOTO", color: GREEN, on: true } : { value: "VAZIO", color: GRAY, on: false };
    case "porta":
      if (state === "VALIDATING") return step >= 3 ? { value: "FECHADA", color: GREEN, on: true } : { value: "ABERTA", color: AMBER, on: true };
      return active ? { value: "FECHADA", color: GREEN, on: true } : { value: "ABERTA", color: GRAY, on: false };
    // driver interaction
    case "pressao": {
      const p = Math.round(20 + car.throttle * 70 + car.gForce * 4);
      return active ? { value: `${p}%`, color: p > 85 ? AMBER : GREEN, on: true } : { value: "—", color: GRAY, on: false };
    }
    case "marcha":
      return active ? { value: `${car.gear}ª`, color: GREEN, on: true } : { value: "N", color: GRAY, on: false };
    // environmental
    case "temp": {
      const t = 24 + car.speed * 0.03;
      return { value: `${t.toFixed(1)}°C`, color: t > 32 ? AMBER : GREEN, on: state !== "STANDBY" };
    }
    case "gases": {
      const ppm = Math.round(12 + car.speed * 0.06);
      return { value: `${ppm}ppm`, color: ppm > 40 ? RED : ppm > 25 ? AMBER : GREEN, on: state !== "STANDBY" };
    }
  }
}

function CockpitDiagram({ car, state, step }: { car: CarState; state: CockpitState; step: number }) {
  const steer = car.steerAngle * 20; // wheel rotation hint

  return (
    <svg width="300" height="335" viewBox="0 0 340 380" style={{ maxWidth: "100%" }}>
      <defs>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#161b22" />
          <stop offset="50%" stopColor="#0d1117" />
          <stop offset="100%" stopColor="#161b22" />
        </linearGradient>
        <radialGradient id="cockpitGlow" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#e8230a" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#e8230a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── CHASSIS (top view, nose up) ── */}
      {/* wheels */}
      {[[92, 88], [248, 88], [86, 300], [254, 300]].map(([x, y], i) => (
        <g key={i}>
          <rect x={x - 12} y={y - 26} width="24" height="52" rx="8" fill="#0a0d11" stroke="#2a3240" strokeWidth="1.5" />
          <rect x={x - 12} y={y - 26} width="24" height="52" rx="8" fill="none" stroke="#1a2028" strokeWidth="4" />
        </g>
      ))}
      {/* front + rear wings */}
      <rect x="70" y="24" width="200" height="12" rx="3" fill="#12161d" stroke="#2a3240" strokeWidth="1" />
      <rect x="60" y="24" width="10" height="12" fill="#e8230a" />
      <rect x="270" y="24" width="10" height="12" fill="#e8230a" />
      <rect x="86" y="336" width="168" height="16" rx="3" fill="#12161d" stroke="#2a3240" strokeWidth="1" />

      {/* monocoque body */}
      <path
        d="M 170,30
           C 150,44 146,70 146,96
           C 128,104 118,128 118,168
           C 118,210 122,250 130,286
           C 138,320 150,338 170,340
           C 190,338 202,320 210,286
           C 218,250 222,210 222,168
           C 222,128 212,104 194,96
           C 194,70 190,44 170,30 Z"
        fill="url(#body)" stroke="#2f3947" strokeWidth="2"
      />
      {/* carbon centerline seams */}
      <line x1="170" y1="40" x2="170" y2="330" stroke="#000" strokeWidth="1" opacity="0.5" />

      {/* cockpit opening + glow */}
      <ellipse cx="170" cy="205" rx="34" ry="58" fill="#05070a" stroke="#3a4657" strokeWidth="2" />
      <ellipse cx="170" cy="205" rx="34" ry="58" fill="url(#cockpitGlow)" />
      {/* halo */}
      <path d="M 170,150 L 170,138 M 142,208 A 30,60 0 0,1 198,208" fill="none" stroke="#20262f" strokeWidth="5" strokeLinecap="round" />

      {/* seat */}
      <path d="M 152,232 Q 170,222 188,232 L 184,262 Q 170,270 156,262 Z" fill="#12161d" stroke="#2a3240" strokeWidth="1.2" />
      {/* mini steering wheel (rotates with input) */}
      <g transform={`translate(170,196) rotate(${steer})`}>
        <rect x="-20" y="-8" width="40" height="16" rx="7" fill="#0a0d11" stroke="#3a4657" strokeWidth="1.5" />
        <rect x="-20" y="-8" width="6" height="16" rx="3" fill="#e8230a" />
        <rect x="14" y="-8" width="6" height="16" rx="3" fill="#e8230a" />
      </g>
      {/* airbox / intake behind head */}
      <path d="M 158,268 Q 170,258 182,268 L 178,286 L 162,286 Z" fill="#0a0d11" stroke="#2a3240" strokeWidth="1" />

      {/* ── SENSOR MARKERS + CALLOUTS ── */}
      {SENSORS.map((s) => {
        const st = sensorStatus(s.key, car, state, step);
        const chipW = 108, chipH = 30;
        const chipX = s.side === "L" ? s.lx : s.lx - chipW + 82;
        const anchorX = s.side === "L" ? chipX + chipW : chipX;
        return (
          <g key={s.key}>
            {/* connector */}
            <line x1={s.dx} y1={s.dy} x2={anchorX} y2={s.ly + chipH / 2} stroke={st.on ? st.color : "#2a3240"} strokeWidth="1" opacity={st.on ? 0.55 : 0.3} />
            {/* marker on chassis */}
            <circle cx={s.dx} cy={s.dy} r="9" fill="none" stroke={st.color} strokeWidth="1.5" opacity={st.on ? 0.5 : 0.25} className={st.on ? "pulse" : undefined} />
            <circle cx={s.dx} cy={s.dy} r="4" fill={st.color} opacity={st.on ? 1 : 0.4} />
            {/* label chip */}
            <rect x={chipX} y={s.ly} width={chipW} height={chipH} rx="4" fill="#0b0e13" stroke={st.on ? st.color : "#222b36"} strokeWidth="1" opacity="0.96" />
            <rect x={chipX} y={s.ly} width="3" height={chipH} rx="1.5" fill={st.color} opacity={st.on ? 1 : 0.4} />
            <text x={chipX + 9} y={s.ly + 12} fill="#cdd6e0" fontSize="8.5" fontFamily="Rajdhani,sans-serif" fontWeight="700" letterSpacing="0.5">{s.name}</text>
            <text x={chipX + 9} y={s.ly + 21} fill="#556170" fontSize="6.5" fontFamily="Inter,sans-serif">{s.spec}</text>
            <text x={chipX + chipW - 8} y={s.ly + 20} textAnchor="end" fill={st.color} fontSize="9" fontFamily="JetBrains Mono,monospace" fontWeight="700">{st.value}</text>
          </g>
        );
      })}

      {/* labels */}
      <text x="170" y="18" textAnchor="middle" fill="#374151" fontSize="8" fontFamily="Rajdhani,sans-serif" letterSpacing="2">DIANTEIRA</text>
      <text x="170" y="368" textAnchor="middle" fill="#374151" fontSize="8" fontFamily="Rajdhani,sans-serif" letterSpacing="2">TRASEIRA</text>
    </svg>
  );
}

// ── Track View (pseudo-3D road ahead) ─────────────────────────────────────────

function TrackView({ speed, steer, distance, gear, drs }: { speed: number; steer: number; distance: number; gear: number; drs: boolean }) {
  const shift = steer * 90;          // lateral curve offset
  const bank = steer * 6;            // slight bank into corners
  const seg = 130;                   // pattern segment size (px)
  const scroll = distance % (seg * 4);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden",
      background: "linear-gradient(180deg,#04060b 0%,#0a1120 46%,#241014 60%,#3a1512 66%,#0a0c10 66%)" }}>

      {/* horizon glow */}
      <div style={{ position: "absolute", left: 0, right: 0, top: "63%", height: 3,
        background: "linear-gradient(90deg,transparent,rgba(232,35,10,0.55),transparent)" }} />
      {/* distant grandstand lights */}
      <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: "13%",
        backgroundImage: "repeating-linear-gradient(90deg,transparent 0 14px,rgba(255,220,150,0.10) 14px 16px)" }} />

      {/* road plane */}
      <div style={{
        position: "absolute", left: "50%", top: "63%", width: "460%", height: "150%",
        transform: `translateX(-50%) translateX(${-shift}px) rotate(${bank}deg) perspective(260px) rotateX(74deg)`,
        transformOrigin: "50% 0%",
        backgroundColor: "#0b0f16",
        backgroundImage: [
          "repeating-linear-gradient(0deg,#e6e6e6 0 30px,transparent 30px 130px)",      // center dashes
          "linear-gradient(90deg,transparent 27%,#c9ccd2 27% 27.7%,transparent 27.7%)", // left edge
          "linear-gradient(90deg,transparent 72.3%,#c9ccd2 72.3% 73%,transparent 73%)", // right edge
          "repeating-linear-gradient(0deg,rgba(255,255,255,0.05) 0 3px,transparent 3px 65px)", // speed rungs
          "linear-gradient(90deg,#0e1420 0 27%,#0b0f16 27% 73%,#0e1420 73% 100%)",       // asphalt/verge
        ].join(","),
        backgroundSize: `12px ${seg}px, 100% 100%, 100% 100%, 100% 65px, 100% 100%`,
        backgroundPosition: `50% ${scroll}px, 0 0, 0 0, 0 ${scroll}px, 0 0`,
        backgroundRepeat: "repeat-y, no-repeat, no-repeat, repeat, no-repeat",
        boxShadow: "inset 0 60px 80px rgba(0,0,0,0.6)",
      }} />

      {/* speed streaks near camera when fast */}
      {speed > 120 && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: clamp((speed - 120) / 180, 0, 0.5),
          background: "radial-gradient(ellipse at 50% 120%,transparent 40%,rgba(232,35,10,0.18) 100%)" }} />
      )}

      {/* HUD overlay: speed + gear on the windshield */}
      <div style={{ position: "absolute", left: 14, bottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>
        <span style={{ fontSize: 34, fontWeight: 700, color: "#e8eaed", textShadow: "0 2px 8px #000" }}>{Math.round(speed).toString().padStart(3, "0")}</span>
        <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>KM/H</span>
      </div>
      <div style={{ position: "absolute", right: 16, bottom: 6, textAlign: "center" }}>
        <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, color: "#e8230a", textShadow: "0 0 24px rgba(232,35,10,0.6)" }}>{gear}</div>
        <div style={{ fontSize: 9, color: "#374151", letterSpacing: 2 }}>MARCHA</div>
      </div>
      {drs && (
        <div style={{ position: "absolute", top: 10, right: 14, fontSize: 12, fontWeight: 700, color: "#22c55e",
          background: "rgba(34,197,94,0.12)", border: "1px solid #22c55e", borderRadius: 4, padding: "2px 8px", letterSpacing: 2 }}>
          DRS ATIVO
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

const INIT_CAR: CarState = {
  speed: 0, rpm: RPM_IDLE, gear: 1, steerAngle: 0,
  throttle: 0, brake: 0, lapTime: 0, bestLap: 0, lapCount: 0,
  sector: 1, sectorTime: 0, gForce: 0, tyreTemp: 28,
  fuel: 100, sessionTime: 0, distance: 0, wheelSpin: false, drs: false, pitLimiter: false,
};

export default function App() {
  const [cockpitState, setCockpitState] = useState<CockpitState>("STANDBY");
  const [validationStep, setValidationStep] = useState(0);
  const [car, setCar] = useState<CarState>(INIT_CAR);
  const keysRef = useRef<Keys>({ up: false, down: false, left: false, right: false, shift: false, ctrl: false, space: false, d: false });
  const carRef = useRef<CarState>(INIT_CAR);
  const pendingShiftRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Keep carRef in sync
  useEffect(() => { carRef.current = car; }, [car]);

  // Keyboard listeners
  useEffect(() => {
    const map: Record<string, keyof Keys> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
      ShiftLeft: "shift", ShiftRight: "shift",
      ControlLeft: "ctrl", ControlRight: "ctrl",
      Space: "space",
    };
    const onKey = (e: KeyboardEvent, v: boolean) => {
      if (map[e.code]) {
        e.preventDefault();
        keysRef.current[map[e.code]] = v;
      }
      // Paddle shifters — edge-triggered (one shift per key press)
      if (v && !e.repeat) {
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") pendingShiftRef.current += 1;   // upshift
        if (e.code === "ControlLeft" || e.code === "ControlRight") pendingShiftRef.current -= 1; // downshift
      }
      // DRS toggle
      if (e.code === "KeyZ" && v) setCar((c) => ({ ...c, drs: !c.drs }));
      // Pit limiter
      if (e.code === "KeyX" && v) setCar((c) => ({ ...c, pitLimiter: !c.pitLimiter }));
    };
    window.addEventListener("keydown", (e) => onKey(e, true));
    window.addEventListener("keyup", (e) => onKey(e, false));
    return () => {
      window.removeEventListener("keydown", (e) => onKey(e, true));
      window.removeEventListener("keyup", (e) => onKey(e, false));
    };
  }, []);

  // Physics loop
  const runPhysics = useCallback((ts: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = ts;
    const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.05);
    lastTimeRef.current = ts;

    const k = keysRef.current;
    const prev = carRef.current;

    // Inputs
    const throttleInput = k.up ? 1 : 0;
    const brakeInput = k.down ? 1 : 0;
    const steerInput = k.left ? -1 : k.right ? 1 : 0;

    // Manual paddle shifting — apply any pending edge-triggered shifts
    let gear = prev.gear;
    if (pendingShiftRef.current !== 0) {
      gear = Math.round(clamp(gear + pendingShiftRef.current, 1, 8));
      pendingShiftRef.current = 0;
    }
    // Stall protection: drop to 1st when nearly stopped
    if (prev.speed < 8 && gear > 1) gear = 1;

    // ── Gearbox synchronised with speed & RPM ──
    // Each gear has a higher top speed; holding throttle always pulls the car
    // toward the current gear's top speed, so upshifting through 1→8 keeps
    // increasing speed all the way to 340 km/h in 8th.
    const gearTop = GEAR_TOP_SPEED[gear];
    const pitCap = prev.pitLimiter ? 80 : 340;
    const ceiling = Math.min(gearTop, pitCap);                  // top speed available right now

    const throttle = throttleInput;
    // target speed we're heading toward, and how fast we get there
    let targetSpeed: number;
    let rate: number;
    if (brakeInput > 0) {
      targetSpeed = 0;
      rate = 2.6;                                               // braking is strong
    } else if (throttle > 0) {
      targetSpeed = ceiling;                                    // pull to the gear's top speed
      rate = 0.55 + (8 - gear) * 0.13;                          // lower gears accelerate quicker
    } else {
      targetSpeed = 0;
      rate = 0.35;                                              // coast / engine braking
    }
    const speed = clamp(
      prev.speed + (targetSpeed - prev.speed) * clamp(rate * dt, 0, 1),
      0,
      ceiling,
    );
    const longAccel = (speed - prev.speed) / Math.max(dt, 0.001); // km/h per s

    // RPM synchronised to gear window: drops on upshift, rises on downshift
    const revNow = clamp(speed / gearTop, 0, 1);
    const targetRpm = speed > 2 ? RPM_IDLE + revNow * (RPM_MAX - RPM_IDLE)
                                : RPM_IDLE + throttle * 3500;
    const rpm = clamp(prev.rpm + (targetRpm - prev.rpm) * (dt * 10), RPM_IDLE, RPM_MAX);

    // Steering — smoothed
    const steerTarget = steerInput * (1 - speed / 600);
    const steerAngle = clamp(prev.steerAngle + (steerTarget - prev.steerAngle) * dt * 8, -1, 1);

    // G-force from lateral + longitudinal
    const latG = Math.abs(steerAngle) * (speed / 100) * 2.5;
    const longG = Math.abs(longAccel) * 0.012;
    const gForce = clamp(latG + longG, 0, 5);

    // Tyre temp driven by speed + braking
    const tyreTarget = 28 + speed * 0.3 + brakeInput * 40;
    const tyreTemp = clamp(prev.tyreTemp + (tyreTarget - prev.tyreTemp) * dt * 0.3, 20, 130);

    // Fuel
    const fuel = clamp(prev.fuel - throttle * dt * 0.005, 0, 100);

    // Lap / sector timing
    const sessionTime = prev.sessionTime + dt;
    const lapTime = prev.lapTime + dt;
    const sectorTime = prev.sectorTime + dt;
    const newSector = sectorTime > 28 ? (prev.sector % 3) + 1 : prev.sector;
    const newLap = lapTime > 84;
    const lapCount = newLap ? prev.lapCount + 1 : prev.lapCount;
    const bestLap = newLap && (prev.bestLap === 0 || lapTime < prev.bestLap) ? lapTime : prev.bestLap;

    // Wheel spin at low gear high throttle
    const wheelSpin = gear <= 2 && throttle > 0.8 && speed < 60;

    // Distance travelled (drives the track view scroll)
    const distance = safe(prev.distance) + speed * dt * 2.4;

    const next: CarState = {
      speed, rpm, gear, steerAngle,
      throttle: throttleInput, brake: brakeInput,
      lapTime: newLap ? 0 : lapTime,
      sectorTime: newSector !== prev.sector || newLap ? 0 : sectorTime,
      bestLap, lapCount,
      sector: newLap ? 1 : newSector,
      gForce, tyreTemp, fuel, sessionTime, distance,
      wheelSpin,
      drs: prev.drs,
      pitLimiter: prev.pitLimiter,
    };

    carRef.current = next;
    setCar(next);
    rafRef.current = requestAnimationFrame(runPhysics);
  }, []);

  // Start/stop physics loop
  useEffect(() => {
    if (cockpitState === "ACTIVE") {
      lastTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(runPhysics);
    } else {
      cancelAnimationFrame(rafRef.current);
      if (cockpitState === "STANDBY") {
        setCar(INIT_CAR);
        carRef.current = INIT_CAR;
      }
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [cockpitState, runPhysics]);

  // Auto-validate occupancy sensors sequentially: cortina → presença → porta
  useEffect(() => {
    if (cockpitState !== "VALIDATING") { setValidationStep(0); return; }
    setValidationStep(0);
    const timers = [
      setTimeout(() => setValidationStep(1), 700),
      setTimeout(() => setValidationStep(2), 1500),
      setTimeout(() => setValidationStep(3), 2300),
      setTimeout(() => setCockpitState("READY"), 3100),
    ];
    return () => timers.forEach(clearTimeout);
  }, [cockpitState]);

  const handleAction = useCallback((next: CockpitState) => {
    setCockpitState(next);
  }, []);

  const isActive = cockpitState === "ACTIVE";
  const lapProgress = car.lapTime / 84;

  // Tyre color
  const tyreColor = car.tyreTemp > 100 ? "#ef4444" : car.tyreTemp > 80 ? "#22c55e" : car.tyreTemp > 60 ? "#f59e0b" : "#94a3b8";

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      style={{ background: "#080a0c", fontFamily: "'Rajdhani',sans-serif" }}
    >
      {/* ── BG CARBON TEXTURE ── */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,0.012) 3px,rgba(255,255,255,0.012) 6px)",
        zIndex: 0,
      }} />

      {/* ── MAIN LAYOUT ── */}
      <div className="relative z-10 w-full h-full flex flex-col" style={{ minHeight: "100vh" }}>

        {/* TOP HUD BAR */}
        <div
          className="flex items-center justify-between px-6 py-2 flex-shrink-0"
          style={{ background: "rgba(0,0,0,0.7)", borderBottom: "1px solid #1e2a38" }}
        >
          {/* LAP TIMES */}
          <div className="flex gap-6">
            <div>
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 2 }}>VOLTA</div>
              <div style={{ color: "#e8eaed", fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{formatLap(car.lapTime)}</div>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 2 }}>MELHOR</div>
              <div style={{ color: "#e8230a", fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{formatLap(car.bestLap)}</div>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 2 }}>VOLTAS</div>
              <div style={{ color: "#e8eaed", fontSize: 22, fontWeight: 700 }}>{car.lapCount}</div>
            </div>
          </div>

          {/* CENTER TITLE */}
          <div className="text-center">
            <div style={{ color: "#e8230a", fontSize: 14, fontWeight: 700, letterSpacing: 4 }}>SMART RACE COCKPIT</div>
            <div style={{ color: "#374151", fontSize: 10 }}>SENAI · MECATRÔNICA · 2026</div>
          </div>

          {/* RIGHT: SESSION + SECTOR */}
          <div className="flex gap-6 items-start">
            <div>
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 2 }}>SESSÃO</div>
              <div style={{ color: "#e8eaed", fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{formatLap(car.sessionTime)}</div>
            </div>
            <div>
              <div style={{ color: "#64748b", fontSize: 10, letterSpacing: 2 }}>SETOR</div>
              <div className="flex gap-1 mt-1">
                {[1,2,3].map((s) => (
                  <div key={s} style={{
                    width: 28, height: 8, borderRadius: 2,
                    background: s < car.sector ? "#22c55e" : s === car.sector ? "#f59e0b" : "#1e2a38",
                  }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* WINDSHIELD / TRACK VIEW */}
        <div className="flex-shrink-0 relative overflow-hidden" style={{ height: "22vh", minHeight: 140, borderBottom: "2px solid #1e2a38" }}>
          <TrackView speed={car.speed} steer={car.steerAngle} distance={car.distance} gear={car.gear} drs={car.drs} />
          {/* RPM shift lights overlaid on top of the windshield */}
          <div className="absolute left-0 right-0 flex justify-center" style={{ top: 8 }}>
            <RPMLEDs rpm={car.rpm} />
          </div>
        </div>

        {/* MIDDLE SECTION */}
        <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

          {/* LEFT COLUMN: Pedals + Sensors */}
          <div className="flex flex-col justify-between p-4 gap-4 flex-shrink-0" style={{ width: 160 }}>

            {/* PEDALS */}
            <div>
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>PEDAIS</div>
              <div className="flex gap-3 justify-center">
                <PedalBar value={car.throttle} color="#22c55e" label="ACS" />
                <PedalBar value={car.brake} color="#e8230a" label="FRE" />
              </div>
            </div>

            {/* SENSOR STATUS */}
            <div className="flex flex-col gap-2">
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2 }}>SENSORES</div>
              {[
                { label: "Pressão", val: `${Math.round(car.throttle * 80 + 20)}%`, ok: true },
                { label: "Temp.Cab", val: `${(24 + car.speed * 0.05).toFixed(1)}°C`, ok: true },
                { label: "Porta",   val: isActive ? "FECHADA" : "ABERTA", ok: isActive },
                { label: "Cortina", val: isActive ? "LIVRE" : "ARMADA", ok: isActive },
                { label: "Gases",   val: `${Math.round(10 + car.speed * 0.05)} ppm`, ok: true },
                { label: "Câmbio",  val: `${car.gear}ª`, ok: true },
                { label: "Pres.",   val: isActive ? "PILOT" : "—", ok: isActive },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between" style={{ fontSize: 10 }}>
                  <span style={{ color: "#374151" }}>{s.label}</span>
                  <span style={{
                    color: s.ok ? "#22c55e" : "#f59e0b",
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 9,
                  }}>{s.val}</span>
                </div>
              ))}
            </div>

            {/* MINI MAP */}
            <div>
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2, marginBottom: 4 }}>PISTA</div>
              <TrackMap progress={lapProgress} />
            </div>
          </div>

          {/* CENTER: COCKPIT DIAGRAM + WHEEL */}
          <div className="flex-1 flex items-start justify-center relative gap-4 overflow-hidden pt-3" style={{ minHeight: 0 }}>

            {/* REALISTIC COCKPIT + SENSOR MAP */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2, marginBottom: 2 }}>MAPA DE SENSORES</div>
              <CockpitDiagram car={car} state={cockpitState} step={validationStep} />
            </div>

            {/* WHEEL + CONTROLS */}
            <div className="flex flex-col items-center justify-center gap-2">

            {/* STEERING WHEEL */}
            <SteeringWheel angle={car.steerAngle} rpm={car.rpm} gear={car.gear} speed={car.speed} drs={car.drs} pitLimiter={car.pitLimiter} />

            {/* WHEEL SPIN INDICATOR */}
            {car.wheelSpin && (
              <div
                className="font-bold tracking-widest pulse"
                style={{ color: "#f59e0b", fontSize: 14, letterSpacing: 4 }}
              >
                ⚠ WHEELSPIN
              </div>
            )}

            {/* KEYBOARD CONTROLS */}
            <div className="mt-2 flex flex-col items-center gap-1.5">
              <div className="flex justify-center">
                <Key label="W▲" active={keysRef.current.up} />
              </div>
              <div className="flex gap-1">
                <Key label="A◄" active={keysRef.current.left} />
                <Key label="S▼" active={keysRef.current.down} />
                <Key label="►D" active={keysRef.current.right} />
              </div>
              <div className="flex gap-1 mt-1">
                <Key label="SHIFT ▲" active={keysRef.current.shift} wide />
                <Key label="CTRL ▼" active={keysRef.current.ctrl} wide />
              </div>
              <div style={{ color: "#2a3a4a", fontSize: 9, letterSpacing: 1, marginTop: 4 }}>
                Z=DRS · X=PIT LIMITER · SHIFT=SUBIR · CTRL=DESCER
              </div>
            </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Speed + Gear + G + Fuel */}
          <div className="flex flex-col justify-between p-4 gap-4 flex-shrink-0" style={{ width: 180 }}>

            {/* SPEED */}
            <div className="text-center">
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2 }}>VELOCIDADE</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 72, fontWeight: 700, color: "#e8eaed", lineHeight: 1 }}>
                {Math.round(car.speed).toString().padStart(3, "0")}
              </div>
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 4 }}>KM/H</div>
            </div>

            {/* GEAR */}
            <div className="text-center">
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2 }}>MARCHA</div>
              <div style={{
                fontSize: 100, fontWeight: 700, lineHeight: 1, color: "#e8230a",
                textShadow: "0 0 40px rgba(232,35,10,0.5)",
              }}>
                {car.gear}
              </div>
            </div>

            {/* RPM Text */}
            <div className="text-center">
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2 }}>RPM</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, color: car.rpm > 12000 ? "#e8230a" : "#e8eaed" }}>
                {Math.round(car.rpm / 100) * 100}
              </div>
            </div>

            {/* G-FORCE */}
            <div>
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2, marginBottom: 4 }}>G-FORCE</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: car.gForce > 3 ? "#ef4444" : "#e8eaed" }}>
                {car.gForce.toFixed(1)}G
              </div>
              <div style={{ height: 6, background: "#111", borderRadius: 3, marginTop: 4 }}>
                <div style={{ height: "100%", borderRadius: 3, width: `${clamp(car.gForce / 5, 0, 1) * 100}%`, background: car.gForce > 3 ? "#ef4444" : "#22c55e", transition: "width 80ms" }} />
              </div>
            </div>

            {/* TYRE TEMP */}
            <div>
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2, marginBottom: 4 }}>PNEU</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: tyreColor }}>
                {Math.round(car.tyreTemp)}°C
              </div>
              <div style={{ fontSize: 9, color: "#374151" }}>
                {car.tyreTemp < 60 ? "FRIO" : car.tyreTemp < 90 ? "ÓTIMO" : car.tyreTemp < 105 ? "QUENTE" : "CRÍTICO"}
              </div>
            </div>

            {/* FUEL */}
            <div>
              <div style={{ color: "#374151", fontSize: 10, letterSpacing: 2, marginBottom: 4 }}>COMBUSTÍVEL</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 24, fontWeight: 700, color: car.fuel < 20 ? "#ef4444" : "#e8eaed" }}>
                {car.fuel.toFixed(1)}%
              </div>
              <div style={{ height: 8, background: "#111", borderRadius: 4, marginTop: 4 }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  width: `${car.fuel}%`,
                  background: car.fuel < 20 ? "#ef4444" : "#fb923c",
                  transition: "width 500ms",
                }} />
              </div>

              {/* DRS / PIT indicators */}
              <div className="flex gap-2 mt-3">
                <div style={{
                  flex: 1, padding: "4px 0", textAlign: "center", borderRadius: 3,
                  background: car.drs ? "#22c55e22" : "#111",
                  border: `1px solid ${car.drs ? "#22c55e" : "#222"}`,
                  color: car.drs ? "#22c55e" : "#333",
                  fontSize: 10, fontWeight: 700,
                }}>DRS</div>
                <div style={{
                  flex: 1, padding: "4px 0", textAlign: "center", borderRadius: 3,
                  background: car.pitLimiter ? "#f59e0b22" : "#111",
                  border: `1px solid ${car.pitLimiter ? "#f59e0b" : "#222"}`,
                  color: car.pitLimiter ? "#f59e0b" : "#333",
                  fontSize: 10, fontWeight: 700,
                }}>PIT</div>
              </div>
            </div>

            {/* PAUSE button */}
            {isActive && (
              <button
                onClick={() => setCockpitState("PAUSED")}
                style={{
                  background: "#111", border: "1px solid #1e2a38", borderRadius: 4,
                  color: "#64748b", fontSize: 11, fontWeight: 700, padding: "6px 0",
                  cursor: "pointer", letterSpacing: 2,
                }}
              >
                ⏸ PAUSAR
              </button>
            )}
          </div>
        </div>

        {/* BOTTOM: RPM BAR (full width) */}
        <div className="flex-shrink-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.6)", borderTop: "1px solid #1e2a38" }}>
          <div className="flex items-center gap-3">
            <span style={{ color: "#374151", fontSize: 10, letterSpacing: 2, minWidth: 28 }}>RPM</span>
            <div className="flex-1 relative h-5 rounded overflow-hidden" style={{ background: "#111" }}>
              <div
                className="h-full transition-all"
                style={{
                  width: `${clamp(car.rpm / RPM_MAX, 0, 1) * 100}%`,
                  background: "linear-gradient(90deg,#22c55e 0%,#f59e0b 55%,#e8230a 80%,#ff00ff 100%)",
                  transition: "width 60ms linear",
                  boxShadow: car.rpm > 12000 ? "0 0 12px #e8230a" : "none",
                }}
              />
              {/* zone markers */}
              {[55, 80, 88].map((p) => (
                <div key={p} className="absolute inset-y-0" style={{ left: `${p}%`, width: 1, background: "rgba(255,255,255,0.15)" }} />
              ))}
            </div>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", color: car.rpm > 12000 ? "#e8230a" : "#e8eaed", fontSize: 14, fontWeight: 700, minWidth: 52, textAlign: "right" }}>
              {Math.round(car.rpm)}
            </span>
          </div>
        </div>
      </div>

      {/* STATE OVERLAY */}
      <StateOverlay state={cockpitState} step={validationStep} onAction={handleAction} />
    </div>
  );
}
