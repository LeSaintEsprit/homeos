/**
 * Graphiques HOMEOS (SVG, sans dépendance) : une série, couleur validée pour les deux
 * thèmes (`--viz-1`), marques fines, grille discrète, info-bulle au survol et au clavier,
 * et toujours une vue tableau équivalente (aucune valeur accessible uniquement au survol).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Graduations « rondes » de 0 au maximum (3 à 5 valeurs). */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 70), Math.max(70, width - 70));
  return (
    <div className="viz-tip" style={{ left, top: tip.y }} role="status">
      {tip.content}
    </div>
  );
}

/** Carte de graphique avec bascule graphique / tableau. */
export function ChartCard({ title, subtitle, table, children, testid, actions }: { title: string; subtitle?: ReactNode; table: ReactNode; children: ReactNode; testid?: string; actions?: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card viz-card" data-testid={testid}>
      <div className="card-title">
        <div>
          <h3>{title}</h3>
          {subtitle && <div className="xsmall muted">{subtitle}</div>}
        </div>
        <div className="row" style={{ ['--gap' as string]: '4px' }}>
          {actions}
          <button className="btn ghost icon sm" onClick={() => setAsTable(!asTable)} aria-pressed={asTable} aria-label={asTable ? 'Afficher le graphique' : 'Afficher le tableau'} title={asTable ? 'Graphique' : 'Tableau'}>
            {asTable ? <BarChart3 size={17} /> : <Table2 size={17} />}
          </button>
        </div>
      </div>
      {asTable ? <div className="viz-table-wrap">{table}</div> : children}
    </section>
  );
}

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  /** Ligne secondaire de l'info-bulle (ex. « 2 achats sans prix »). */
  note?: string;
  /** Période en cours (incomplète). */
  current?: boolean;
}

const PLOT_H = 168;
const AXIS_H = 26;
const PAD_L = 46;
const PAD_R = 8;
const PAD_T = 18;

/** Colonnes d'une série dans le temps, valeurs étiquetées avec parcimonie (maximum et période en cours). */
export function ColumnChart({ data, format, formatAxis, reference }: { data: ColumnDatum[]; format: (v: number) => string; formatAxis: (v: number) => string; reference?: { value: number; label: string } | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(...data.map((d) => d.value), reference?.value ?? 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.min(24, Math.max(4, band * 0.62));
  const y = (v: number) => PAD_T + PLOT_H - (top > 0 ? (v / top) * PLOT_H : 0);
  const maxKey = data.reduce((m, d) => (d.value > (data.find((x) => x.key === m)?.value ?? -1) ? d.key : m), data[0]?.key ?? '');
  // N'afficher qu'une étiquette d'axe sur deux quand les barres sont serrées.
  const every = band < 34 ? Math.ceil(34 / Math.max(band, 1)) : 1;
  const show = (d: ColumnDatum) => {
    setActive(d.key);
    const i = data.indexOf(d);
    setTip({
      x: PAD_L + band * i + band / 2,
      y: Math.max(4, y(d.value) - 8),
      content: (
        <>
          <strong className="num">{format(d.value)}</strong>
          <span>{d.label}{d.current ? ' (en cours)' : ''}</span>
          {d.note && <span className="subtle">{d.note}</span>}
        </>
      ),
    });
  };
  const hide = () => {
    setActive(null);
    setTip(null);
  };
  return (
    <div className="viz" ref={ref} onPointerLeave={hide}>
      {width > 0 && (
        <svg width={width} height={PAD_T + PLOT_H + AXIS_H} role="img" aria-label={data.map((d) => `${d.label} : ${format(d.value)}`).join(' ; ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
              <text x={PAD_L - 8} y={y(t)} className="viz-axis num" textAnchor="end" dominantBaseline="middle">{formatAxis(t)}</text>
            </g>
          ))}
          {reference && reference.value > 0 && (
            <g>
              <line x1={PAD_L} x2={width - PAD_R} y1={y(reference.value)} y2={y(reference.value)} className="viz-ref" />
              <text x={width - PAD_R} y={y(reference.value) - 5} className="viz-axis" textAnchor="end">{reference.label}</text>
            </g>
          )}
          {data.map((d, i) => {
            const cx = PAD_L + band * i + band / 2;
            const h = y(0) - y(d.value);
            const x = cx - barW / 2;
            const r = Math.min(4, h, barW / 2);
            const path = h > 0 ? `M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + barW - r} Q${x + barW},${y(d.value)} ${x + barW},${y(d.value) + r} V${y(0)} Z` : '';
            const labelIt = d.value > 0 && (d.key === maxKey || d.current);
            return (
              <g key={d.key}>
                {path && <path d={path} className={`viz-mark ${active === d.key ? 'on' : ''}`} />}
                {labelIt && <text x={cx} y={y(d.value) - 6} textAnchor="middle" className="viz-label num">{format(d.value)}</text>}
                {i % every === 0 && <text x={cx} y={y(0) + 17} textAnchor="middle" className={`viz-axis ${d.current ? 'strong' : ''}`}>{d.label}</text>}
                <rect
                  x={PAD_L + band * i}
                  y={PAD_T}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label} : ${format(d.value)}${d.note ? `, ${d.note}` : ''}`}
                  onPointerEnter={() => show(d)}
                  onPointerMove={() => active !== d.key && show(d)}
                  onFocus={() => show(d)}
                  onBlur={hide}
                  data-testid="viz-col"
                />
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

/** Barres horizontales classées (une teinte), valeur au bout de la barre. */
export function RankedBars({ data, format, max: maxRows = 8, otherLabel = 'Autres' }: { data: BarDatum[]; format: (v: number) => string; max?: number; otherLabel?: string }) {
  const rows = data.length > maxRows ? [...data.slice(0, maxRows - 1), { key: '__other', label: `${otherLabel} (${data.length - maxRows + 1})`, value: data.slice(maxRows - 1).reduce((s, d) => s + d.value, 0) }] : data;
  const max = Math.max(...rows.map((d) => d.value), 0);
  return (
    <div className="ranked" role="list">
      {rows.map((d) => (
        <div key={d.key} className="ranked-row" role="listitem" data-testid="ranked-row">
          <div className="ranked-name">
            <span>{d.label}</span>
            {'sub' in d && d.sub && <span className="xsmall subtle">{d.sub}</span>}
          </div>
          <div className="ranked-track">
            <span className="ranked-bar" style={{ width: `${max > 0 ? Math.max(1, (d.value / max) * 100) : 0}%` }} />
            <span className="ranked-value num">{format(d.value)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface LinePoint {
  date: string;
  value: number;
  note?: string;
}

/** Courbe d'une série dans le temps (prix unitaire), réticule qui se cale sur le point le plus proche. */
export function LineChart({ points, format, formatAxis, formatDate }: { points: LinePoint[]; format: (v: number) => string; formatAxis: (v: number) => string; formatDate: (d: string) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const t = points.map((p) => Date.parse(`${p.date}T12:00:00`));
  const t0 = Math.min(...t);
  const t1 = Math.max(...t);
  const vmax = Math.max(...points.map((p) => p.value));
  const ticks = niceTicks(vmax);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD_L - 16);
  const x = (ms: number) => PAD_L + (t1 > t0 ? ((ms - t0) / (t1 - t0)) * plotW : plotW / 2);
  const y = (v: number) => PAD_T + PLOT_H - (top > 0 ? (v / top) * PLOT_H : 0);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(t[i])},${y(p.value)}`).join(' ');
  const nearest = (clientX: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = clientX - box.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(t[i]) - px) < Math.abs(x(t[best]) - px)) best = i;
    setHover(best);
  };
  useEffect(() => setHover(null), [points]);
  const last = points.length - 1;
  const h = hover != null ? points[hover] : null;
  return (
    <div className="viz" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && points.length > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={PAD_T + PLOT_H + AXIS_H}
          role="img"
          aria-label={points.map((p) => `${formatDate(p.date)} : ${format(p.value)}`).join(' ; ')}
          onPointerMove={(e) => nearest(e.clientX)}
          onPointerDown={(e) => nearest(e.clientX)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setHover((i) => Math.min(last, (i ?? -1) + 1));
            if (e.key === 'ArrowLeft') setHover((i) => Math.max(0, (i ?? last + 1) - 1));
          }}
          onBlur={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD_L} x2={width - 16} y1={y(v)} y2={y(v)} className={v === 0 ? 'viz-base' : 'viz-grid'} />
              <text x={PAD_L - 8} y={y(v)} className="viz-axis num" textAnchor="end" dominantBaseline="middle">{formatAxis(v)}</text>
            </g>
          ))}
          <text x={x(t0)} y={y(0) + 17} className="viz-axis" textAnchor="start">{formatDate(points[0].date)}</text>
          {last > 0 && <text x={x(t1)} y={y(0) + 17} className="viz-axis" textAnchor="end">{formatDate(points[last].date)}</text>}
          {h && <line x1={x(t[hover!])} x2={x(t[hover!])} y1={PAD_T} y2={y(0)} className="viz-cross" />}
          <path d={d} className="viz-line" />
          {points.map((p, i) => (
            <circle key={i} cx={x(t[i])} cy={y(p.value)} r={hover === i ? 5 : 4} className="viz-dot" />
          ))}
          <text x={Math.min(x(t1), width - 18)} y={y(points[last].value) - 10} textAnchor="end" className="viz-label num">{format(points[last].value)}</text>
        </svg>
      )}
      <Tooltip
        tip={h ? { x: x(t[hover!]), y: Math.max(4, y(h.value) - 10), content: <><strong className="num">{format(h.value)}</strong><span>{formatDate(h.date)}</span>{h.note && <span className="subtle">{h.note}</span>}</> } : null}
        width={width}
      />
    </div>
  );
}
