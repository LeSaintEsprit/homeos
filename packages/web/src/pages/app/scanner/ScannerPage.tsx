import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, CameraOff, ClipboardCheck, Flashlight, ImageUp, Keyboard, Minus, PackagePlus, Plus, ScanLine, Undo2, Volume2, VolumeX } from 'lucide-react';
import {
  computeInventoryDiff, describeCode, formatQty, newId, parseScannedCode, roundQty, type InventorySession, type Lot, type ParsedCode, type Product, type ProductCode,
} from '@homeos/shared';
import { useCatalog } from '../../../lib/hooks';
import { useCan, useEngine, useView } from '../../../lib/sync/react';
import { toast } from '../../../lib/toast';
import { decode } from '../../../lib/scan/decoder';
import { formatShortDate } from '../../../lib/format';
import { Segmented, Switch } from '../../../ui/Controls';
import { Sheet } from '../../../ui/Sheet';
import { Field } from '../../../ui/Field';
import { IdentifySheet } from './Identify';

type Mode = 'reception' | 'consumption' | 'inventory';

interface FeedItem {
  id: string;
  opId: string | null;
  mode: Mode;
  label: string;
  detail: string;
  tone: 'ok' | 'warn' | 'error';
  undone?: boolean;
}

const MODE_LABEL: Record<Mode, string> = { reception: 'Réception', consumption: 'Consommation', inventory: 'Inventaire' };
const DEBOUNCE_MS = 2500;

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1046 : 330;
    g.gain.value = 0.06;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.07 : 0.18));
    o.onended = () => void ctx.close();
  } catch {
    /* audio indisponible */
  }
}

export function ScannerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Lancé depuis un inventaire guidé : session et espace imposés.
  const linkedSession = params.get('inventaire');
  const engine = useEngine();
  const view = useView();
  const canWrite = useCan('stock.write');
  const { locations, stores } = useCatalog();
  const [mode, setMode] = useState<Mode>(linkedSession ? 'inventory' : 'reception');
  const [perScan, setPerScan] = useState(1);
  const [continuous, setContinuous] = useState(true);
  const [sound, setSound] = useState(true);
  const [locationId, setLocationId] = useState(params.get('emplacement') ?? '');
  const [storeId, setStoreId] = useState('');
  const [askDate, setAskDate] = useState(true);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied' | 'unavailable'>('off');
  const [torch, setTorch] = useState<boolean | null>(null);
  const [flash, setFlash] = useState<FeedItem | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [unknown, setUnknown] = useState<ParsedCode | null>(null);
  const [dateQ, setDateQ] = useState<{ product: Product; code: ProductCode | null; parsed: ParsedCode } | null>(null);
  const [dateValue, setDateValue] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [review, setReview] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(linkedSession);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const pausedRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const lotsRef = useRef(new Map<string, string>());
  const linesRef = useRef(new Map<string, string>());
  const fileRef = useRef<HTMLInputElement>(null);

  pausedRef.current = !!unknown || !!dateQ || manualOpen || review;

  const current = () => engine.state.get().view;

  const push = useCallback(
    (item: Omit<FeedItem, 'id'>) => {
      const it = { ...item, id: newId() };
      setFeed((f) => [it, ...f].slice(0, 40));
      setFlash(it);
      window.setTimeout(() => setFlash((x) => (x?.id === it.id ? null : x)), 1600);
      if (sound) beep(item.tone !== 'error');
      if (navigator.vibrate) navigator.vibrate(item.tone === 'error' ? [60, 40, 60] : 35);
    },
    [sound],
  );

  // ── Traitement d'un produit identifié selon le mode.
  const process = useCallback(
    async (productId: string, code: ProductCode | null, parsed: ParsedCode, dateOverride?: { date: string | null; fromUser: boolean }) => {
      const v = current();
      const product = v.product.get(productId) as Product | undefined;
      if (!product) return;
      const qty = roundQty(perScan * (code?.packQty ?? 1));
      if (mode === 'reception') {
        const gs1Date = parsed.expiry ?? parsed.bestBefore;
        const knownDate = dateOverride ? dateOverride.date : gs1Date;
        // Une seule question, et seulement si ce produit a habituellement une date.
        if (!dateOverride && !gs1Date && askDate) {
          const usuallyDated = ([...v.lot.values()] as Lot[]).some((l) => l.productId === product.id && l.expiryDate);
          const cat = product.categoryId ? v.category.get(product.categoryId)?.name ?? '' : '';
          if (usuallyDated || /frais|surgel/i.test(cat)) {
            setDateValue('');
            setDateQ({ product, code, parsed });
            return;
          }
        }
        const key = `${product.id}|${knownDate ?? ''}|${parsed.batch ?? ''}`;
        const lotId = lotsRef.current.get(key) ?? newId();
        lotsRef.current.set(key, lotId);
        const out = await engine.run('stock.add', {
          productId: product.id,
          lotId,
          quantity: qty,
          kind: 'purchase',
          expiryDate: knownDate ?? null,
          expirySource: knownDate ? (dateOverride?.fromUser ? 'manual' : 'gs1') : null,
          expiryKind: knownDate ? (parsed.bestBefore && !parsed.expiry && !dateOverride ? 'ddm' : 'dlc') : null,
          batchNumber: parsed.batch,
          locationId: locationId || product.locationId,
          storeId: storeId || null,
          source: 'scan',
        });
        if (!out.ok) return push({ opId: null, mode, label: product.name, detail: out.result.error?.message ?? 'Refusé', tone: 'error' });
        const extra = [...describeCode(parsed), knownDate && !gs1Date ? `date ${formatShortDate(knownDate)}` : !knownDate ? 'date inconnue' : ''].filter(Boolean).join(' · ');
        push({ opId: out.opId, mode, label: `+${formatQty(qty, product.unit)} ${product.name}`, detail: `ajouté au stock${extra ? ` · ${extra}` : ''}`, tone: out.result.warnings.length ? 'warn' : 'ok' });
      } else if (mode === 'consumption') {
        const out = await engine.run('stock.consume', { productId: product.id, quantity: qty, source: 'scan' });
        if (!out.ok) return push({ opId: null, mode, label: product.name, detail: out.result.error?.message ?? 'Refusé', tone: 'error' });
        const w = out.result.warnings[0];
        push({ opId: out.opId, mode, label: `−${formatQty(qty, product.unit)} ${product.name}`, detail: w ? w.message : 'consommé', tone: w ? 'warn' : 'ok' });
      } else {
        if (!locationId) {
          toast("Choisissez d'abord l'emplacement que vous inventoriez.", 'warning');
          return;
        }
        let sid = sessionId;
        if (!sid || (current().inventorySession.get(sid) as InventorySession | undefined)?.status !== 'open') {
          sid = newId();
          const loc = current().location.get(locationId);
          const r = await engine.run('inventory.start', { id: sid, kind: 'check', title: `${loc?.name ?? 'Inventaire'} (scanner)`, locationIds: [locationId] });
          if (!r.ok) return push({ opId: null, mode, label: product.name, detail: r.result.error?.message ?? 'Refusé', tone: 'error' });
          setSessionId(sid);
          linesRef.current.clear();
        }
        const s = current().inventorySession.get(sid) as InventorySession;
        const date = parsed.expiry ?? parsed.bestBefore;
        // Même produit, même date, même espace : on cumule sur la ligne existante (y compris d'une session reprise).
        const lineKey = `${product.id}|${date ?? ''}|${locationId}`;
        const existing = s.lines.find((l) => l.productId === product.id && (l.expiryDate ?? '') === (date ?? '') && l.locationId === locationId && l.unit === product.unit);
        const lineId = existing?.id ?? linesRef.current.get(lineKey) ?? newId();
        linesRef.current.set(lineKey, lineId);
        const prev = s.lines.find((l) => l.id === lineId);
        const total = roundQty((prev?.quantity ?? 0) + qty);
        const r = await engine.run('inventory.upsertLine', {
          sessionId: sid,
          line: { id: lineId, productId: product.id, code: parsed.code, quantity: total, unit: product.unit, locationId, expiryDate: date, expirySource: date ? 'gs1' : null, expiryKind: parsed.expiry ? 'dlc' : parsed.bestBefore ? 'ddm' : null, batchNumber: parsed.batch },
        });
        if (!r.ok) return push({ opId: null, mode, label: product.name, detail: r.result.error?.message ?? 'Refusé', tone: 'error' });
        push({ opId: null, mode, label: `${product.name} : ${formatQty(total, product.unit)} compté(s)`, detail: 'aucune correction tant que vous n’avez pas validé', tone: 'ok' });
      }
    },
    [engine, perScan, mode, askDate, locationId, storeId, sessionId, push],
  );

  // ── Pipeline commun : caméra, photo, saisie manuelle.
  const handleText = useCallback(
    async (raw: string, fromCamera: boolean) => {
      const parsed = parseScannedCode(raw, new Date());
      if (parsed.validCheckDigit === false) {
        push({ opId: null, mode, label: 'Lecture incorrecte', detail: `Le code ${parsed.code} est invalide (clé de contrôle) : rescannez.`, tone: 'error' });
        return;
      }
      if (parsed.code.length < 4) {
        push({ opId: null, mode, label: 'Code non reconnu', detail: 'Ce code ne correspond pas à un produit.', tone: 'error' });
        return;
      }
      const now = Date.now();
      // Anti-doublon : un même code relu par la caméra dans les 2,5 s est ignoré.
      if (fromCamera && lastRef.current.code === parsed.code && now - lastRef.current.at < DEBOUNCE_MS) return;
      lastRef.current = { code: parsed.code, at: now };
      const code = ([...current().productCode.values()] as ProductCode[]).find((c) => c.code === parsed.code) ?? null;
      if (code) await process(code.productId, code, parsed);
      else setUnknown(parsed);
    },
    [process, push, mode],
  );

  // ── Caméra.
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera('off');
    setTorch(null);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setCamera('unavailable');
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch(caps.torch ? false : null);
      setCamera('on');
    } catch (e) {
      setCamera((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }, []);

  useEffect(() => {
    if (canWrite) void startCamera();
    return stopCamera;
  }, [canWrite, startCamera, stopCamera]);

  useEffect(() => {
    if (camera !== 'on') return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !busyRef.current && !pausedRef.current) {
        busyRef.current = true;
        try {
          const scale = Math.min(1, 960 / v.videoWidth);
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const r = await decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (r) {
            await handleText(r.text, true);
            if (!continuous) stopCamera();
          }
        } catch {
          /* image illisible : on continue */
        } finally {
          busyRef.current = false;
        }
      }
      if (alive) window.setTimeout(tick, 160);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [camera, continuous, handleText, stopCamera]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch == null) return;
    await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).catch(() => {});
    setTorch(!torch);
  };

  const fromPhoto = async (file: File) => {
    const r = await decode(file).catch(() => null);
    if (r) await handleText(r.text, false);
    else push({ opId: null, mode, label: 'Aucun code trouvé', detail: 'Prenez la photo plus près, bien éclairée et nette.', tone: 'error' });
  };

  const undo = async (it: FeedItem) => {
    if (!it.opId) return;
    const out = await engine.run('movement.revertOp', { targetOpId: it.opId, reason: 'Annulé depuis le scanner' });
    if (out.ok) {
      setFeed((f) => f.map((x) => (x.id === it.id ? { ...x, undone: true } : x)));
      toast('Scan annulé');
    } else toast(out.result.error?.message ?? 'Annulation impossible', 'error');
  };

  // ── Revue des écarts d'inventaire.
  const session = sessionId ? (view.inventorySession.get(sessionId) as InventorySession | undefined) : undefined;
  const diffs = useMemo(
    () => (session ? computeInventoryDiff(session, (id) => view.product.get(id) as Product | undefined, (pid) => ([...view.lot.values()] as Lot[]).filter((l) => l.productId === pid)) : []),
    [session, view.product, view.lot],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set(diffs.map((d) => d.productId))), [diffs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyInventory = async () => {
    if (!session) return;
    const out = await engine.run('inventory.apply', { sessionId: session.id, decisions: diffs.map((d) => ({ productId: d.productId, expected: d.expected, apply: selected.has(d.productId) })) });
    if (!out.ok) return toast(out.result.error?.message ?? 'Validation impossible', 'error');
    if (out.result.conflicts.length) toast(`${out.result.conflicts.length} produit(s) ont changé pendant l'inventaire : recomptez-les.`, 'warning');
    else toast('Inventaire validé : stock corrigé');
    setReview(false);
    setSessionId(null);
  };

  if (!canWrite) {
    return (
      <div className="empty">
        <h3>Scanner indisponible</h3>
        <p className="muted">Votre rôle (lecture seule) ne permet pas de modifier le stock.</p>
      </div>
    );
  }

  return (
    <div className="scanner">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <button className="btn ghost sm" onClick={() => navigate(-1)}><ArrowLeft size={17} /> Retour</button>
        <div className="row" style={{ ['--gap' as string]: '4px' }}>
          <button className="btn ghost icon sm" onClick={() => setSound(!sound)} aria-label={sound ? 'Couper le son' : 'Activer le son'}>{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          {torch != null && <button className="btn ghost icon sm" onClick={() => void toggleTorch()} aria-label="Lampe" aria-pressed={torch}><Flashlight size={18} /></button>}
        </div>
      </div>
      <Segmented label="Mode de scan" value={mode} onChange={(m) => { setMode(m); lastRef.current = { code: '', at: 0 }; }} options={[{ value: 'reception', label: 'Réception' }, { value: 'consumption', label: 'Consommation' }, { value: 'inventory', label: 'Inventaire' }]} />
      <div className={`viewfinder mode-${mode}`}>
        <video ref={videoRef} playsInline muted aria-label="Caméra" />
        {camera !== 'on' && (
          <div className="vf-msg">
            {camera === 'starting' ? <span className="spinner" /> : <CameraOff size={28} />}
            <span>
              {camera === 'denied'
                ? "Accès à la caméra refusé : autorisez-le dans les réglages du navigateur."
                : camera === 'unavailable'
                  ? 'Aucune caméra disponible. Importez une photo du code ou saisissez-le.'
                  : camera === 'starting'
                    ? 'Ouverture de la caméra…'
                    : 'Caméra en pause.'}
            </span>
            {(camera === 'off' || camera === 'denied') && <button className="btn sm" onClick={() => void startCamera()}><Camera size={16} /> Activer</button>}
          </div>
        )}
        <div className="vf-frame" aria-hidden="true" />
        {flash && (
          <div className={`vf-flash ${flash.tone}`} role="status" data-testid="scan-flash">
            <strong>{flash.label}</strong>
            <span>{flash.detail}</span>
          </div>
        )}
        <div className="vf-mode">{MODE_LABEL[mode]}{continuous ? ' · continu' : ''}</div>
      </div>

      <div className="scan-controls">
        <div className="per-scan">
          <span className="small muted">Par scan</span>
          <button className="btn icon sm" aria-label="Moins" onClick={() => setPerScan((q) => Math.max(0.5, roundQty(q >= 2 ? q - 1 : q - 0.5)))}><Minus size={16} /></button>
          <strong className="num" data-testid="per-scan">{String(perScan).replace('.', ',')}</strong>
          <button className="btn icon sm" aria-label="Plus" onClick={() => setPerScan((q) => roundQty(q < 1 ? q + 0.5 : q + 1))}><Plus size={16} /></button>
          {[0.5, 1, 6].map((n) => <button key={n} className="chip" aria-pressed={perScan === n} onClick={() => setPerScan(n)}>{String(n).replace('.', ',')}</button>)}
        </div>
        <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
          <button className="btn sm" onClick={() => setManualOpen(true)}><Keyboard size={16} /> Saisir un code</button>
          <button className="btn sm" onClick={() => fileRef.current?.click()}><ImageUp size={16} /> Photo d'un code</button>
          <input ref={fileRef} type="file" accept="image/*" hidden data-testid="scan-photo" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void fromPhoto(f); }} />
          {mode === 'inventory' && session && linkedSession === session.id && (
            <button className="btn primary sm" onClick={() => navigate(`/inventaire/inventaires/${session.id}?espace=${locationId}`)} data-testid="back-to-session"><ClipboardCheck size={16} /> Retour à l'inventaire ({session.lines.filter((l) => l.locationId === locationId).length} ligne(s) ici)</button>
          )}
          {mode === 'inventory' && session && linkedSession !== session.id && session.lines.length > 0 && (
            <button className="btn primary sm" onClick={() => setReview(true)}><ClipboardCheck size={16} /> Vérifier les écarts ({session.lines.length})</button>
          )}
        </div>
        {mode === 'reception' && (
          <div className="grid-2">
            <Field label="Ranger dans">
              <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Emplacement habituel du produit</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Magasin (facultatif)">
              <select className="select" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">—</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        {mode === 'inventory' && (
          <Field label="Emplacement inventorié" hint="Seul le stock de cet emplacement est comparé au comptage.">
            <select className="select" value={locationId} onChange={(e) => { setLocationId(e.target.value); if (!linkedSession) setSessionId(null); }}>
              <option value="">Choisir…</option>
              {locations.filter((l) => !linkedSession || !session || session.locations.length === 0 || session.locations.some((x) => x.locationId === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        )}
        <div className="row spread small">
          <span>Mode continu (enchaîner les produits)</span>
          <Switch label="Mode continu" checked={continuous} onChange={(v) => { setContinuous(v); if (v && camera === 'off') void startCamera(); }} />
        </div>
        {mode === 'reception' && (
          <div className="row spread small">
            <span>Demander la date si le code n'en contient pas</span>
            <Switch label="Demander la date" checked={askDate} onChange={setAskDate} />
          </div>
        )}
      </div>

      {feed.length > 0 && (
        <>
          <div className="section-title">Derniers scans</div>
          <div className="card pad-0" data-testid="scan-feed">
            {feed.map((it) => (
              <div key={it.id} className={`list-row scan-item ${it.tone} ${it.undone ? 'undone' : ''}`}>
                <span className={`dot ${it.tone}`} />
                <span className="meta"><span className="title" style={{ display: 'block' }}>{it.label}</span><span className="sub">{it.undone ? 'annulé' : it.detail}</span></span>
                {it.opId && !it.undone && <button className="btn ghost icon sm" aria-label={`Annuler ${it.label}`} onClick={() => void undo(it)}><Undo2 size={17} /></button>}
              </div>
            ))}
          </div>
        </>
      )}

      <IdentifySheet
        parsed={unknown}
        locationId={locationId || null}
        onClose={() => setUnknown(null)}
        onResolved={(p) => {
          const parsed = unknown!;
          setUnknown(null);
          const code = ([...current().productCode.values()] as ProductCode[]).find((c) => c.code === parsed.code) ?? null;
          void process(p.id, code, parsed);
        }}
      />

      <Sheet
        open={!!dateQ}
        onClose={() => setDateQ(null)}
        title={dateQ ? `Date de « ${dateQ.product.name} » ?` : ''}
        footer={
          <>
            <button className="btn" onClick={() => { const q = dateQ!; setDateQ(null); void process(q.product.id, q.code, q.parsed, { date: null, fromUser: true }); }}>Date inconnue</button>
            <button className="btn primary" disabled={!dateValue} onClick={() => { const q = dateQ!; setDateQ(null); void process(q.product.id, q.code, q.parsed, { date: dateValue, fromUser: true }); }}>Enregistrer</button>
          </>
        }
      >
        <p className="small muted">Ce code ne contient pas de date. Indiquez celle de l'emballage — ou « Date inconnue » : aucune date n'est inventée.</p>
        <Field label="Date de péremption"><input className="input" type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} autoFocus /></Field>
      </Sheet>

      <Sheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Saisir un code"
        footer={<button className="btn primary" disabled={!manualCode.trim()} onClick={() => { const c = manualCode.trim(); setManualOpen(false); setManualCode(''); void handleText(c, false); }}><ScanLine size={16} /> Valider</button>}
      >
        <Field label="Code-barres" hint="Les chiffres sous le code-barres (EAN-13, EAN-8, UPC…).">
          <input className="input num" inputMode="numeric" value={manualCode} onChange={(e) => setManualCode(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && manualCode.trim()) { const c = manualCode.trim(); setManualOpen(false); setManualCode(''); void handleText(c, false); } }} />
        </Field>
      </Sheet>

      <Sheet
        open={review}
        onClose={() => setReview(false)}
        title="Écarts d'inventaire"
        footer={
          <>
            <button className="btn ghost" onClick={() => setReview(false)}>Continuer à compter</button>
            <button className="btn primary" onClick={() => void applyInventory()} data-testid="apply-inventory">Corriger {selected.size} produit(s)</button>
          </>
        }
      >
        <p className="small muted">Comparaison entre le stock enregistré et votre comptage. Rien n'est modifié sans votre validation.</p>
        <div className="card pad-0 flat">
          {diffs.map((d) => {
            const p = view.product.get(d.productId) as Product;
            return (
              <label key={d.productId} className="list-row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(d.productId)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(d.productId); else s.delete(d.productId); setSelected(s); }} />
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{p?.name}</span>
                  <span className="sub">
                    Enregistré ici {formatQty(d.expected, p.unit)} · compté {formatQty(d.counted, p.unit)}
                    {(() => {
                      const all = ([...view.lot.values()] as Lot[]).filter((l) => l.productId === d.productId).reduce((t, l) => t + l.quantity, 0);
                      const elsewhere = roundQty(all - d.expected);
                      return elsewhere > 0 ? ` · ${formatQty(elsewhere, p.unit)} ailleurs ou sans emplacement (non concernés)` : '';
                    })()}
                  </span>
                </span>
                <span className={`badge ${d.delta === 0 ? 'success' : d.delta < 0 ? 'danger' : 'warning'}`} data-testid="inventory-delta">{d.delta === 0 ? 'Conforme' : `${d.delta > 0 ? '+' : '−'}${formatQty(Math.abs(d.delta), p.unit)}`}</span>
              </label>
            );
          })}
        </div>
      </Sheet>
      <div className="xsmall subtle center" style={{ marginTop: 16 }}><PackagePlus size={12} style={{ verticalAlign: '-2px' }} /> Données produits : Open Food Facts, Open Beauty Facts, Open Products Facts (licence ODbL).</div>
    </div>
  );
}
