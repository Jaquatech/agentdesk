import { useEffect, useRef, useState } from "react";
import { get, parseJson, useLiveEvents, type Activity, type Agent, type AgentState } from "../api.ts";
import { OfficeScene, roleColor, type OfficeAgent } from "./scene.ts";
import { OFFICE_STYLES, lookFor } from "./palette.ts";
import { featuresFromSettings } from "./layout.ts";
import { loadImage, logoSpecFromSettings } from "./logo.ts";

type OfficeData = {
  settings: Record<string, string>;
  agents: Pick<Agent, "id" | "name" | "role" | "appearance" | "enabled">[];
  teams?: { id: number; name: string; members: number[] }[];
  activity: Activity[];
};

const STATE_LABEL: Record<AgentState, string> = {
  idle: "on a break", thinking: "thinking", reading: "reading code", typing: "writing code",
  running: "running a command", reviewing: "reviewing", waiting: "waiting for checks", error: "hit a problem",
};

/** The office: an isometric room with one desk per agent; idle agents hang out in the lounge. */
export function Office({ chatId }: { chatId?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef(new OfficeScene());
  const styleRef = useRef(OFFICE_STYLES.nordic);
  const [data, setData] = useState<OfficeData | null>(null);
  const [activity, setActivity] = useState<Map<number, Activity>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    get<OfficeData>("/api/office").then((d) => {
      setData(d);
      setActivity(new Map(d.activity.map((a) => [a.agentId, a])));
    });
  }, []);

  useLiveEvents((ev) => {
    if (ev.type === "agent") setActivity((m) => new Map(m).set(ev.agentId, ev));
    if (ev.type === "hello") setActivity(new Map(ev.activity.map((a) => [a.agentId, a])));
  });

  // keep the scene in sync with data
  useEffect(() => {
    if (!data) return;
    const scene = sceneRef.current;
    styleRef.current = OFFICE_STYLES[data.settings.office_style] ?? OFFICE_STYLES.nordic;
    let cancelled = false;
    loadImage(data.settings.logo_image || "").then((img) => {
      if (cancelled) return;
      scene.configure({ features: featuresFromSettings(data.settings), teams: data.teams ?? [], logo: logoSpecFromSettings(data.settings, img) });
    });
    return () => { cancelled = true; };
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const agents: OfficeAgent[] = data.agents.filter((a) => a.enabled).map((a) => {
      const act = activity.get(a.id);
      return {
        id: a.id, name: a.name, role: a.role, look: lookFor(a.name, parseJson(a.appearance, {})),
        state: act?.state ?? "idle", detail: act?.detail,
      };
    });
    sceneRef.current.setAgents(agents);
  }, [data, activity]);

  useEffect(() => { sceneRef.current.selected = selected; }, [selected]);

  // render loop
  useEffect(() => {
    const canvas = canvasRef.current!, stage = stageRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0, last = performance.now();
    let dpr = 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const r = stage.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    const frame = (now: number) => {
      const scene = sceneRef.current;
      scene.update(Math.min(64, now - last), Date.now());
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene.draw(ctx, canvas.width / dpr, canvas.height / dpr, styleRef.current, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const toCanvas = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const move = (e: MouseEvent) => {
      const p = toCanvas(e);
      sceneRef.current.hover = sceneRef.current.hitTest(p.x, p.y);
      canvas.style.cursor = sceneRef.current.hover ? "pointer" : "default";
    };
    const click = (e: MouseEvent) => { const p = toCanvas(e); setSelected(sceneRef.current.hitTest(p.x, p.y)); };
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("click", click);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("click", click);
    };
  }, []);

  const agents = data?.agents.filter((a) => a.enabled) ?? [];
  const sel = agents.find((a) => a.id === selected);
  const selAct = sel ? activity.get(sel.id) : undefined;

  return (
    <div className="office-wrap">
      <div className="office-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="office-canvas" aria-label="Office view of the agents" />
        {agents.length === 0 && data && (
          <div className="empty" style={{ position: "absolute", color: "#cfd8d2" }}>
            The office is empty. Create agents under <b>Agents</b> and they get a desk here.
          </div>
        )}
        {sel && (
          <div className="card card-pad" style={{ position: "absolute", right: 12, top: 12, width: 260 }}>
            <div className="row">
              <b>{sel.name}</b>
              <span className="badge" style={{ color: "#1f2421", background: roleColor(sel.role) }}>{sel.role}</span>
              <span className="spacer" />
              <button className="btn small" onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {STATE_LABEL[selAct?.state ?? "idle"]}{selAct?.detail ? `: ${selAct.detail}` : ""}
              {selAct?.chatId && chatId && selAct.chatId !== chatId ? " (in another chat)" : ""}
            </div>
          </div>
        )}
      </div>
      <div className="office-legend">
        {agents.map((a) => {
          const act = activity.get(a.id);
          const st = act?.state ?? "idle";
          return (
            <span key={a.id} className="who">
              <span className="swatch" style={{ background: lookFor(a.name, parseJson(a.appearance, {})).shirt }} />
              <b>{a.name}</b> <span className="hint">{st === "waiting" && act?.detail === "needs your OK" ? "✋ needs your OK" : STATE_LABEL[st]}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
