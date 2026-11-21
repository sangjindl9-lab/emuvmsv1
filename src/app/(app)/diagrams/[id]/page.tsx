"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatNumber, useApi } from "@/lib/client";
import { Alert, Badge, Button, Field, Spinner } from "@/components/ui";

type El = {
  id?: string;
  elementKey: string;
  symbolType: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  assetId: string | null;
  tagId: string | null;
  props?: Record<string, unknown>;
  zIndex: number;
};

type DiagramData = {
  id: string;
  name: string;
  siteId: string;
  version: number;
  backgroundUrl: string | null;
  canvas: { width?: number; height?: number } | null;
  elements: El[];
  site: { name: string };
};

const PALETTE = [
  { type: "BREAKER", label: "차단기" },
  { type: "TRANSFORMER", label: "변압기" },
  { type: "GENERATOR", label: "발전기" },
  { type: "BUS", label: "모선" },
  { type: "METER", label: "계량기" },
  { type: "UPS", label: "UPS" },
  { type: "PV", label: "태양광" },
  { type: "ESS", label: "ESS" },
  { type: "EV", label: "EV충전" },
  { type: "LOAD", label: "부하" },
  { type: "TEXT", label: "텍스트" },
  { type: "LINE", label: "선로" },
];

function SymbolShape({ element, fill, stroke }: { element: El; fill: string; stroke: string }) {
  const w = element.width;
  const h = element.height;
  switch (element.symbolType) {
    case "BREAKER":
      return (
        <g>
          <rect x={0} y={h * 0.3} width={w} height={h * 0.4} fill="none" stroke={stroke} strokeWidth={2} rx={2} />
          <line x1={w * 0.25} y1={h * 0.3} x2={w * 0.7} y2={h} stroke={fill} strokeWidth={2.5} />
          <circle cx={w * 0.25} cy={h * 0.3} r={2.5} fill={stroke} />
          <circle cx={w * 0.7} cy={h} r={2.5} fill={stroke} />
        </g>
      );
    case "TRANSFORMER":
      return (
        <g>
          <circle cx={w / 2} cy={h * 0.38} r={h * 0.2} fill="none" stroke={stroke} strokeWidth={2} />
          <circle cx={w / 2} cy={h * 0.62} r={h * 0.2} fill="none" stroke={stroke} strokeWidth={2} />
        </g>
      );
    case "GENERATOR":
      return (
        <g>
          <circle cx={w / 2} cy={h / 2} r={h * 0.36} fill="none" stroke={stroke} strokeWidth={2} />
          <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fontSize={12} fill={stroke}>G</text>
        </g>
      );
    case "BUS":
      return <rect x={0} y={h * 0.42} width={w} height={h * 0.16} fill={fill} stroke={stroke} />;
    case "METER":
      return (
        <g>
          <rect x={w * 0.15} y={h * 0.15} width={w * 0.7} height={h * 0.7} fill="none" stroke={stroke} strokeWidth={2} rx={3} />
          <text x={w / 2} y={h * 0.58} textAnchor="middle" fontSize={11} fill={stroke}>kWh</text>
        </g>
      );
    case "UPS":
      return (
        <g>
          <rect x={w * 0.15} y={h * 0.2} width={w * 0.7} height={h * 0.6} fill="none" stroke={stroke} strokeWidth={2} rx={3} />
          <text x={w / 2} y={h * 0.58} textAnchor="middle" fontSize={10} fill={stroke}>UPS</text>
        </g>
      );
    case "PV":
      return (
        <g>
          <rect x={w * 0.1} y={h * 0.2} width={w * 0.8} height={h * 0.6} fill="none" stroke={stroke} strokeWidth={2} />
          <line x1={w * 0.1} y1={h * 0.5} x2={w * 0.9} y2={h * 0.5} stroke={stroke} />
          <line x1={w * 0.4} y1={h * 0.2} x2={w * 0.4} y2={h * 0.8} stroke={stroke} />
          <line x1={w * 0.65} y1={h * 0.2} x2={w * 0.65} y2={h * 0.8} stroke={stroke} />
        </g>
      );
    case "ESS":
      return (
        <g>
          <rect x={w * 0.15} y={h * 0.15} width={w * 0.7} height={h * 0.7} fill="none" stroke={stroke} strokeWidth={2} rx={3} />
          <text x={w / 2} y={h * 0.58} textAnchor="middle" fontSize={10} fill={stroke}>ESS</text>
        </g>
      );
    case "EV":
      return (
        <g>
          <rect x={w * 0.2} y={h * 0.15} width={w * 0.6} height={h * 0.7} fill="none" stroke={stroke} strokeWidth={2} rx={5} />
          <text x={w / 2} y={h * 0.58} textAnchor="middle" fontSize={10} fill={stroke}>EV</text>
        </g>
      );
    case "LOAD":
      return <path d={`M ${w * 0.2} ${h * 0.2} L ${w * 0.8} ${h * 0.8} M ${w * 0.8} ${h * 0.2} L ${w * 0.2} ${h * 0.8}`} stroke={stroke} strokeWidth={2} />;
    case "LINE":
      return <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke} strokeWidth={2} />;
    default:
      return <rect width={w} height={h} fill="none" stroke={stroke} strokeDasharray="4 3" />;
  }
}

export default function DiagramEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, error, loading } = useApi<DiagramData>(`diagrams/${id}`);
  const assets = useApi<{ items: { id: string; name: string; breakerState: string; assetType: string }[] }>("assets");
  const live = useApi<{ items: { id: string; name: string; lastValue: number | null; unit: string | null; quality: string }[] }>("live", { pollMs: 5000 });
  const [elements, setElements] = useState<El[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [background, setBackground] = useState("");
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ key: string; offsetX: number; offsetY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (data?.elements) {
      setElements(data.elements.map((el) => ({ ...el, props: (el.props ?? {}) as Record<string, unknown> })));
      setDirty(false);
    }
    if (data) setBackground(data.backgroundUrl ?? "");
  }, [data]);

  const canvas = useMemo(() => ({ width: data?.canvas?.width ?? 1600, height: data?.canvas?.height ?? 900 }), [data]);
  const assetMap = useMemo(() => new Map((assets.data?.items ?? []).map((a) => [a.id, a])), [assets.data]);
  const tagMap = useMemo(() => new Map((live.data?.items ?? []).map((t) => [t.id, t])), [live.data]);
  const selectedElement = elements.find((el) => el.elementKey === selected) ?? null;

  const add = (type: string) => {
    const key = `EL_${Date.now().toString(36).toUpperCase()}`;
    const element: El = {
      elementKey: key,
      symbolType: type,
      label: PALETTE.find((p) => p.type === type)?.label ?? type,
      x: 80 + (elements.length % 8) * 110,
      y: 80 + Math.floor(elements.length / 8) * 90,
      width: type === "BUS" || type === "LINE" ? 160 : 80,
      height: 60,
      rotation: 0,
      assetId: null,
      tagId: null,
      props: {},
      zIndex: elements.length + 1,
    };
    setElements([...elements, element]);
    setSelected(key);
    setDirty(true);
  };

  const update = (patch: Partial<El>) => {
    if (!selectedElement) return;
    setElements(elements.map((el) => (el.elementKey === selectedElement.elementKey ? { ...el, ...patch } : el)));
    setDirty(true);
  };

  const remove = () => {
    if (!selectedElement) return;
    setElements(elements.filter((el) => el.elementKey !== selectedElement.elementKey));
    setSelected(null);
    setDirty(true);
  };

  const toCanvas = (event: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };

  const onPointerDown = (event: React.PointerEvent, element: El) => {
    event.stopPropagation();
    setSelected(element.elementKey);
    const point = toCanvas(event);
    drag.current = { key: element.elementKey, offsetX: point.x - element.x, offsetY: point.y - element.y };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const point = toCanvas(event);
    setElements((prev) =>
      prev.map((el) =>
        el.elementKey === drag.current?.key ? { ...el, x: Math.round(point.x - drag.current.offsetX), y: Math.round(point.y - drag.current.offsetY) } : el,
      ),
    );
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api(`diagrams/${id}/elements`, {
        method: "PUT",
        body: { elements: elements.map((el) => ({ ...el, props: el.props ?? {} })) },
      });
      setDirty(false);
      setMessage("도면이 저장되었습니다.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert kind="error">{error ?? "도면을 찾을 수 없습니다."}</Alert>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/diagrams" className="text-[11px] text-[var(--eum-accent)] hover:underline">← 도면 목록</Link>
            <h1 className="text-[17px] font-extrabold">{data.name}</h1>
            <Badge value="UNKNOWN" label={`v${data.version}${dirty ? " · 미저장" : ""}`} />
          </div>
          <p className="text-[11px] text-[var(--eum-muted)]">{data.site.name} · 요소 {elements.length}개 · 드래그로 이동, 클릭으로 선택</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button onClick={() => setScale(Math.max(0.4, Number((scale - 0.15).toFixed(2))))}>−</Button>
          <span className="w-12 text-center text-[11px]">{Math.round(scale * 100)}%</span>
          <Button onClick={() => setScale(Math.min(2, Number((scale + 0.15).toFixed(2))))}>+</Button>
          <Button onClick={() => setScale(1)}>100%</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "저장 중…" : "저장"}</Button>
        </div>
      </div>
      {message ? <Alert kind="info">{message}</Alert> : null}
      <div className="grid gap-3 xl:grid-cols-[150px_1fr_250px]">
        <div className="eum-panel p-2">
          <div className="mb-1 text-[10.5px] font-semibold text-[var(--eum-muted)]">심벌 팔레트</div>
          <div className="grid grid-cols-2 gap-1 xl:grid-cols-1">
            {PALETTE.map((item) => (
              <button key={item.type} className="eum-btn justify-start px-2 py-1 text-[11px]" onClick={() => add(item.type)}>+ {item.label}</button>
            ))}
          </div>
        </div>
        <div className="eum-panel overflow-auto bg-[#050d15] p-2">
          <svg
            ref={svgRef}
            width={canvas.width * scale}
            height={canvas.height * scale}
            viewBox={`0 0 ${canvas.width} ${canvas.height}`}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
            onClick={() => setSelected(null)}
            className="select-none"
          >
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#122536" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width={canvas.width} height={canvas.height} fill="url(#grid)" />
            {data.backgroundUrl ? <image href={data.backgroundUrl} width={canvas.width} height={canvas.height} opacity={0.35} /> : null}
            {elements.map((element) => {
              const asset = element.assetId ? assetMap.get(element.assetId) : null;
              const tag = element.tagId ? tagMap.get(element.tagId) : null;
              const isSelected = element.elementKey === selected;
              const stroke = isSelected ? "#23c3e6" : asset?.breakerState === "CLOSED" ? "#2fbf71" : asset?.breakerState === "TRIP" ? "#e5574b" : "#8fb4cc";
              const fill = asset?.breakerState === "TRIP" ? "#6e2a2a" : "#143246";
              return (
                <g
                  key={element.elementKey}
                  transform={`translate(${element.x} ${element.y}) rotate(${element.rotation} ${element.width / 2} ${element.height / 2})`}
                  onPointerDown={(event) => onPointerDown(event, element)}
                  style={{ cursor: "move" }}
                >
                  {isSelected ? <rect x={-4} y={-4} width={element.width + 8} height={element.height + 8} fill="none" stroke="#23c3e6" strokeDasharray="3 2" /> : null}
                  <SymbolShape element={element} fill={fill} stroke={stroke} />
                  <text x={element.width / 2} y={element.height + 14} textAnchor="middle" fontSize={11} fill="#cfe2ef">{element.label}</text>
                  {tag ? (
                    <text x={element.width / 2} y={element.height + 27} textAnchor="middle" fontSize={10} fill="#7fd6ef">
                      {tag.lastValue !== null ? `${formatNumber(tag.lastValue, 2)} ${tag.unit ?? ""}` : "값 없음"}
                    </text>
                  ) : null}
                  {asset ? <text x={element.width / 2} y={-6} textAnchor="middle" fontSize={9} fill="#7f9bb3">{asset.breakerState}</text> : null}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="eum-panel space-y-2 p-3">
          <div className="text-[11.5px] font-bold">선택 요소</div>
          {!selectedElement ? (
            <p className="text-[11px] text-[var(--eum-muted)]">도면의 심벌을 클릭하거나 팔레트에서 추가하세요.</p>
          ) : (
            <div className="space-y-2">
              <Field label="표시명"><input className="eum-input" value={selectedElement.label ?? ""} onChange={(e) => update({ label: e.target.value })} /></Field>
              <Field label="심벌 종류">
                <select className="eum-input" value={selectedElement.symbolType} onChange={(e) => update({ symbolType: e.target.value })}>
                  {PALETTE.map((p) => <option key={p.type} value={p.type}>{p.label}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="X"><input className="eum-input" type="number" value={selectedElement.x} onChange={(e) => update({ x: Number(e.target.value) })} /></Field>
                <Field label="Y"><input className="eum-input" type="number" value={selectedElement.y} onChange={(e) => update({ y: Number(e.target.value) })} /></Field>
                <Field label="너비"><input className="eum-input" type="number" value={selectedElement.width} onChange={(e) => update({ width: Number(e.target.value) })} /></Field>
                <Field label="높이"><input className="eum-input" type="number" value={selectedElement.height} onChange={(e) => update({ height: Number(e.target.value) })} /></Field>
              </div>
              <Field label="전력설비 연결">
                <select className="eum-input" value={selectedElement.assetId ?? ""} onChange={(e) => update({ assetId: e.target.value || null })}>
                  <option value="">없음</option>
                  {(assets.data?.items ?? []).map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.breakerState})</option>)}
                </select>
              </Field>
              <Field label="계측 태그 연결">
                <select className="eum-input" value={selectedElement.tagId ?? ""} onChange={(e) => update({ tagId: e.target.value || null })}>
                  <option value="">없음</option>
                  {(live.data?.items ?? []).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}{tag.unit ? ` (${tag.unit})` : ""}</option>)}
                </select>
              </Field>
              <Button variant="danger" onClick={remove}>요소 삭제</Button>
            </div>
          )}
          <div className="border-t border-[var(--eum-line)] pt-2">
            <Field label="도면 배경 URL (PDF/CAD 변환 이미지)">
              <input className="eum-input" value={background} onChange={(e) => setBackground(e.target.value)} placeholder="https://.../drawing.png" />
            </Field>
            <Button
              onClick={async () => {
                try {
                  await api(`diagrams/${id}`, { method: "PATCH", body: { backgroundUrl: background } });
                  setMessage("배경이 적용되었습니다. 새로고침합니다.");
                  window.location.reload();
                } catch (err) {
                  setMessage((err as Error).message);
                }
              }}
            >
              배경 적용
            </Button>
          </div>
          <div className="border-t border-[var(--eum-line)] pt-2 text-[10px] leading-relaxed text-[var(--eum-muted)]">
            차단기 색상: 계통 정상(CLOSED) 초록, 개방(OPEN) 회색, 트립(TRIP) 빨강. 자산을 연결하면 실시간 상태가 반영됩니다.<br />
            PDF/CAD 도면 배경은 상단 API(PATCH diagrams/:id)의 backgroundUrl로 등록할 수 있습니다.
          </div>
        </div>
      </div>
    </div>
  );
}
