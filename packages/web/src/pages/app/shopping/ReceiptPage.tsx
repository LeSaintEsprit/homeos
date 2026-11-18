import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle2, FileImage, Plus, Receipt, ScanText, Trash2, TriangleAlert } from 'lucide-react';
import {
  formatMoney, matchReceiptLabel, newId, parseEuros, parseReceipt,
  type MatchConfidence, type ParsedReceipt, type Product, type Store, type UnitCode,
} from '@homeos/shared';
import { recognizeText, type OcrProgress } from '../../../lib/ocr';
import { toast } from '../../../lib/toast';
import { useCatalog, useHousehold, useToday, parseQty } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { Switch } from '../../../ui/Controls';
import { Field } from '../../../ui/Field';
import { PageHead } from '../Shell';

const CONF: Record<MatchConfidence, { label: string; tone: string; hint: string }> = {
  sure: { label: 'Sûr', tone: 'success', hint: 'Libellé déjà associé lors d’un ticket précédent' },
  likely: { label: 'Probable', tone: 'info', hint: 'Même nom qu’un de vos produits' },
  uncertain: { label: 'À vérifier', tone: 'warning', hint: 'Nom seulement ressemblant : confirmez ou changez' },
  none: { label: 'Inconnu', tone: '', hint: 'Aucun produit correspondant' },
};

interface DraftLine {
  id: string;
  label: string;
  qty: string;
  unit: UnitCode;
  price: string;
  discountCents: number;
  /** id d'un produit, 'create' (nouveau produit) ou '' (dépense seulement). */
  target: string;
  confidence: MatchConfidence;
  stock: boolean;
  /** L'utilisateur a modifié/confirmé la correspondance. */
  touched: boolean;
}

const euros = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

function toDraft(parsed: ParsedReceipt, products: Product[], storeId: string | null): DraftLine[] {
  return parsed.lines.map((l) => {
    const m = matchReceiptLabel(l.label, products, storeId);
    const target = m.productId ?? '';
    return {
      id: newId(),
      label: l.label.charAt(0) + l.label.slice(1).toLowerCase(),
      qty: String(l.quantity).replace('.', ','),
      unit: l.weighed ? 'kg' : (m.productId ? (products.find((p) => p.id === m.productId)?.unit ?? 'piece') : 'piece'),
      price: euros(l.totalCents),
      discountCents: l.discountCents,
      target,
      confidence: m.confidence,
      // Mise en stock proposée seulement quand la correspondance est sûre ou probable.
      stock: m.confidence === 'sure' || m.confidence === 'likely',
      touched: false,
    };
  });
}

function LineCard({ line, products, onChange, onRemove }: { line: DraftLine; products: Product[]; onChange: (p: Partial<DraftLine>) => void; onRemove: () => void }) {
  const c = CONF[line.confidence];
  const product = line.target && line.target !== 'create' ? products.find((p) => p.id === line.target) : undefined;
  const needsCheck = line.confidence === 'uncertain' && !line.touched;
  const sorted = useMemo(() => {
    const top = product ? [product] : [];
    return [...top, ...products.filter((p) => p.id !== product?.id).sort((a, b) => a.name.localeCompare(b.name, 'fr'))];
  }, [products, product]);
  return (
    <div className={`card receipt-line ${needsCheck ? 'needs-check' : ''}`} data-testid="receipt-line" data-confidence={line.confidence}>
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <input className="input grow" value={line.label} onChange={(e) => onChange({ label: e.target.value })} aria-label="Libellé" maxLength={160} />
        <button className="btn ghost icon sm" onClick={onRemove} aria-label={`Retirer la ligne ${line.label}`}><Trash2 size={16} /></button>
      </div>
      <div className="grid-3">
        <Field label="Quantité"><input className="input num" inputMode="decimal" value={line.qty} onChange={(e) => onChange({ qty: e.target.value })} /></Field>
        <Field label="Unité">
          <select className="select" value={line.unit} onChange={(e) => onChange({ unit: e.target.value as UnitCode })}>
            {(product ? [...new Set([product.unit, 'piece', 'kg'])] : ['piece', 'kg', 'g', 'l', 'bouteille', 'paquet']).map((u) => <option key={u} value={u}>{u === 'piece' ? 'unité' : u}</option>)}
          </select>
        </Field>
        <Field label="Prix payé"><input className="input num" inputMode="decimal" value={line.price} onChange={(e) => onChange({ price: e.target.value })} data-testid="line-price" /></Field>
      </div>
      {line.discountCents > 0 && <div className="xsmall muted">Remise déduite : {formatMoney(line.discountCents)}</div>}
      <Field label={<span className="row" style={{ ['--gap' as string]: '6px' }}>Produit <span className={`badge ${c.tone}`} title={c.hint} data-testid="match-badge">{line.touched && line.target ? 'Confirmé' : c.label}</span></span>}>
        <select
          className="select"
          value={line.target}
          onChange={(e) => {
            const v = e.target.value;
            const p = products.find((x) => x.id === v);
            onChange({ target: v, touched: true, stock: v !== '', unit: p ? p.unit : line.unit });
          }}
          data-testid="line-target"
        >
          <option value="">Dépense seulement (pas de produit)</option>
          <option value="create">Nouveau produit « {line.label.trim() || '…'} »</option>
          {sorted.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      {needsCheck && <div className="xsmall" style={{ color: 'var(--warning)', fontWeight: 700 }}>{c.hint}.</div>}
      <div className="row spread">
        <span className="small">Mettre en stock</span>
        <Switch label={`Mettre en stock ${line.label}`} checked={line.stock && !!line.target} disabled={!line.target} onChange={(v) => onChange({ stock: v, touched: true })} />
      </div>
    </div>
  );
}

export function ReceiptPage() {
  const view = useView();
  const run = useRun();
  const navigate = useNavigate();
  const today = useToday();
  const canWrite = useCan('purchase.write');
  const { stores, location } = useCatalog();
  const { currency } = useHousehold();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'photo' | 'reading' | 'review'>('photo');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [text, setText] = useState('');
  const [storeId, setStoreId] = useState('');
  const [newStore, setNewStore] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [total, setTotal] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
  const products = useMemo(() => ([...view.product.values()] as Product[]).filter((p) => !p.archived), [view.product]);
  const money = (c: number) => formatMoney(c, currency);

  const read = async (file: File) => {
    setStep('reading');
    try {
      const t = await recognizeText(file, 'receipt', setProgress);
      setText(t);
      const p = parseReceipt(t, [...view.store.values()] as Store[], today);
      setParsed(p);
      setStoreId(p.storeId ?? '');
      setNewStore(!p.storeId && p.storeName ? p.storeName : null);
      setDate(p.date ?? today);
      setTotal(euros(p.totalCents));
      setLines(toDraft(p, products, p.storeId));
      setStep('review');
    } catch {
      setStep('photo');
      toast('La lecture du ticket a échoué. Réessayez avec une photo plus nette.', 'error');
    }
  };
  const manual = () => {
    setParsed({ storeName: null, storeId: null, date: null, totalCents: null, lines: [], globalDiscountCents: 0, warnings: [] });
    setLines([]);
    setText('');
    setDate(today);
    setTotal('');
    setStep('review');
  };
  const update = (id: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const sum = lines.reduce((s, l) => s + (parseEuros(l.price) ?? 0), 0) - (parsed?.globalDiscountCents ?? 0);
  const totalCents = total.trim() ? parseEuros(total) : null;
  const mismatch = totalCents != null && lines.length > 0 && Math.abs(sum - totalCents) > Math.max(2, totalCents * 0.01);
  const unchecked = lines.filter((l) => l.confidence === 'uncertain' && !l.touched).length;
  const stockCount = lines.filter((l) => l.stock && l.target).length;
  const invalid = lines.some((l) => !l.label.trim() || !(parseQty(l.qty) ?? 0));

  const save = async () => {
    if (!lines.length || invalid) return;
    setBusy(true);
    let sid = storeId || null;
    if (!sid && newStore) {
      sid = newId();
      const o = await run('store.upsert', { id: sid, name: newStore });
      if (!o.ok) sid = null;
    }
    const out = await run(
      'receipt.apply',
      {
        id: newId(),
        storeId: sid,
        date,
        totalCents,
        lines: lines.map((l) => {
          const createId = newId();
          const product = l.target && l.target !== 'create' ? products.find((p) => p.id === l.target) : undefined;
          return {
            id: newId(),
            label: l.label.trim(),
            quantity: parseQty(l.qty)!,
            unit: l.unit,
            totalCents: l.price.trim() ? parseEuros(l.price) : null,
            discountCents: l.discountCents || null,
            productId: product?.id ?? null,
            createProduct: l.target === 'create' ? { id: createId, name: l.label.trim(), unit: l.unit } : null,
            stock: l.stock && !!l.target,
            purchaseId: newId(),
            lotId: newId(),
            locationId: product?.locationId ?? null,
            learnAlias: true,
          };
        }),
      },
      { success: `Ticket enregistré : ${lines.length} achat${lines.length > 1 ? 's' : ''}${stockCount ? `, ${stockCount} mis en stock` : ''}` },
    );
    setBusy(false);
    if (out.ok) navigate('/depenses');
  };

  if (!canWrite) return <div className="alert info">Votre rôle ne permet pas d'enregistrer des achats.</div>;
  return (
    <>
      <PageHead title="Ticket de caisse" eyebrow={<Link to="/courses" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Courses</Link>} />
      {step === 'photo' && (
        <div className="card stack">
          <div className="row"><span className="oc-icon"><Receipt size={22} /></span><strong>Enregistrez vos achats depuis le ticket</strong></div>
          <p className="small muted">Le ticket est lu sur cet appareil (aucune image n'est envoyée ailleurs). Vous vérifiez ensuite chaque ligne : rien n'est ajouté au stock ni aux dépenses avant votre validation.</p>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden data-testid="receipt-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }} />
          <button className="btn primary lg" onClick={() => fileRef.current?.click()}><Camera size={19} /> Photographier le ticket</button>
          <button className="btn" onClick={() => { if (fileRef.current) { fileRef.current.removeAttribute('capture'); fileRef.current.click(); fileRef.current.setAttribute('capture', 'environment'); } }}><FileImage size={18} /> Importer une image</button>
          <button className="btn ghost" onClick={manual}>Saisir le ticket à la main</button>
          <p className="xsmall subtle">Conseils : ticket à plat, bien éclairé, cadré en entier, sans reflet.</p>
        </div>
      )}
      {step === 'reading' && (
        <div className="card center" role="status" style={{ padding: 32 }}>
          <ScanText size={30} className="subtle" />
          <p className="strong" style={{ marginTop: 10 }}>{progress?.stage === 'recognizing' ? `Lecture du ticket… ${Math.round((progress.progress ?? 0) * 100)} %` : 'Préparation de la lecture…'}</p>
          <p className="small muted">La première lecture charge le moteur (quelques secondes), ensuite il reste sur l'appareil.</p>
        </div>
      )}
      {step === 'review' && parsed && (
        <div className="stack">
          {parsed.warnings.filter((w) => !w.startsWith('Le total')).map((w) => <div key={w} className="alert warning"><TriangleAlert size={18} /> {w}</div>)}
          <div className="card">
            <div className="stack" style={{ ['--gap' as string]: '10px' }}>
              <Field label="Magasin">
                <select className="select" value={storeId} onChange={(e) => { setStoreId(e.target.value); if (e.target.value) setNewStore(null); }} data-testid="receipt-store">
                  <option value="">{newStore ? `Nouveau : ${newStore}` : '—'}</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <div className="grid-2 always">
                <Field label="Date"><input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} data-testid="receipt-date" /></Field>
                <Field label="Total du ticket"><input className="input num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} data-testid="receipt-total" /></Field>
              </div>
            </div>
            <div className={`small ${mismatch ? '' : 'muted'}`} style={mismatch ? { color: 'var(--danger)', fontWeight: 700, marginTop: 8 } : { marginTop: 8 }} data-testid="receipt-sum">
              Somme des lignes : {money(sum)}{totalCents != null && (mismatch ? ` — différente du total (${money(totalCents)}) : une ligne a pu être mal lue ou oubliée.` : ' — conforme au total.')}
            </div>
          </div>
          {unchecked > 0 && <div className="alert warning" data-testid="unchecked"><TriangleAlert size={18} /> {unchecked} correspondance{unchecked > 1 ? 's' : ''} à vérifier (nom seulement ressemblant) : elles ne seront pas mises en stock sans votre confirmation.</div>}
          {lines.map((l) => <LineCard key={l.id} line={l} products={products} onChange={(p) => update(l.id, p)} onRemove={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} />)}
          <button className="btn" onClick={() => setLines((ls) => [...ls, { id: newId(), label: '', qty: '1', unit: 'piece', price: '', discountCents: 0, target: '', confidence: 'none', stock: false, touched: true }])} data-testid="add-receipt-line"><Plus size={17} /> Ajouter une ligne</button>
          {text && <details className="xsmall subtle"><summary>Texte lu sur le ticket</summary><pre className="ocr-text">{text}</pre></details>}
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setStep('photo')}>Recommencer avec une autre photo</button>
          <div className="card flat receipt-foot">
            <div className="small">
              <strong>{lines.length}</strong> achat{lines.length > 1 ? 's' : ''} · <strong>{stockCount}</strong> mis en stock{stockCount ? ` (${[...new Set(lines.filter((l) => l.stock && l.target && l.target !== 'create').map((l) => location(products.find((p) => p.id === l.target)?.locationId)?.name).filter(Boolean))].join(', ') || 'emplacement habituel'})` : ''} · {money(sum)}
            </div>
            <button className="btn primary block" style={{ marginTop: 8 }} disabled={busy || !lines.length || invalid} onClick={() => void save()} data-testid="receipt-save"><CheckCircle2 size={18} /> Enregistrer le ticket</button>
            {invalid && <div className="xsmall" style={{ color: 'var(--danger)', marginTop: 6 }}>Chaque ligne doit avoir un libellé et une quantité.</div>}
          </div>
        </div>
      )}
    </>
  );
}
