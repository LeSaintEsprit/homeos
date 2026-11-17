import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  ADJUST_REASON_LABELS, compatibleUnits, defaultStep, formatQty, newId, roundQty, toStockUnit, unitDef, unitLabel, effectiveExpiry,
  type AdjustReason, type Lot, type Product, type UnitCode,
} from '@homeos/shared';
import { useCatalog, useHousehold, parseQty } from '../../../lib/hooks';
import { useRun } from '../../../lib/sync/react';
import { Sheet } from '../../../ui/Sheet';
import { Field } from '../../../ui/Field';
import { Segmented, Switch } from '../../../ui/Controls';
import { formatShortDate } from '../../../lib/format';

export type StockAction = 'consume' | 'add' | 'adjust' | 'waste' | 'move' | 'open' | 'finish' | 'missing' | 'expiry';

const TITLES: Record<StockAction, string> = {
  consume: 'Consommer',
  add: 'Ajouter au stock',
  adjust: 'Corriger la quantité',
  waste: 'Jeter',
  move: 'Déplacer',
  open: 'Signaler ouvert',
  finish: 'Déclarer terminé',
  missing: 'Signaler manquant',
  expiry: 'Date de péremption',
};

/** Saisie d'une quantité décimale avec unité compatible et pas adapté. */
export function QtyInput({ value, onChange, unit, units, onUnit, label = 'Quantité', autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  unit: UnitCode;
  units?: UnitCode[];
  onUnit?: (u: UnitCode) => void;
  label?: string;
  autoFocus?: boolean;
}) {
  const step = defaultStep(unit);
  const q = parseQty(value) ?? 0;
  const set = (n: number) => onChange(String(roundQty(Math.max(0, n))).replace('.', ','));
  const quick = unitDef(unit).continuous ? (unit === 'g' || unit === 'ml' ? [100, 250, 500, 1000] : unit === 'cl' ? [25, 50, 75, 100] : [0.25, 0.5, 1, 1.5]) : [0.5, 1, 2, 6];
  return (
    <Field label={label}>
      <div className="qty-input">
        <button type="button" className="btn icon" aria-label="Diminuer" onClick={() => set(q - step)}><Minus size={20} /></button>
        <input className="input num" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} aria-label={label} />
        <button type="button" className="btn icon" aria-label="Augmenter" onClick={() => set(q + step)}><Plus size={20} /></button>
        {units && units.length > 1 && onUnit ? (
          <select className="select unit-select" value={unit} onChange={(e) => onUnit(e.target.value as UnitCode)} aria-label="Unité">
            {units.map((u) => <option key={u} value={u}>{unitLabel(u, 2)}</option>)}
          </select>
        ) : (
          <span className="unit-tag">{unitLabel(unit, q)}</span>
        )}
      </div>
      <div className="row wrap" style={{ ['--gap' as string]: '6px', marginTop: 4 }}>
        {quick.map((n) => (
          <button type="button" key={n} className="chip" onClick={() => set(n)}>{String(n).replace('.', ',')}</button>
        ))}
      </div>
    </Field>
  );
}

function LotPicker({ lots, product, value, onChange, allowAuto = true }: { lots: Lot[]; product: Product; value: string; onChange: (v: string) => void; allowAuto?: boolean }) {
  const { tz } = useHousehold();
  if (lots.length <= 1 && allowAuto) return null;
  return (
    <Field label="Lot">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAuto && <option value="">Automatique (date la plus proche d'abord)</option>}
        {lots.map((l) => {
          const eff = effectiveExpiry(l, product, tz);
          return (
            <option key={l.id} value={l.id}>
              {formatQty(l.quantity, product.unit)}{eff ? ` · ${formatShortDate(eff)}` : ' · date inconnue'}{l.openedAt ? ' · ouvert' : ''}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

export function StockActionSheet({ action, product, lots, lot, onClose }: { action: StockAction | null; product: Product; lots: Lot[]; lot?: Lot | null; onClose: () => void }) {
  const run = useRun();
  const { locations, stores } = useCatalog();
  const units = useMemo(() => compatibleUnits(product), [product]);
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<UnitCode>(product.unit);
  const [lotId, setLotId] = useState('');
  const [expiry, setExpiry] = useState('');
  const [expiryKind, setExpiryKind] = useState<'dlc' | 'ddm'>('dlc');
  const [locationId, setLocationId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [price, setPrice] = useState('');
  const [purchase, setPurchase] = useState(false);
  const [approx, setApprox] = useState(false);
  const [reason, setReason] = useState<AdjustReason>('count');
  const [waste, setWaste] = useState<'expired' | 'spoiled' | 'other'>('spoiled');
  const [toList, setToList] = useState(true);
  const [busy, setBusy] = useState(false);

  const total = roundQty(lots.reduce((s, l) => s + l.quantity, 0));
  const target = lot ?? (lotId ? lots.find((l) => l.id === lotId) : undefined);

  // Réinitialisé à l'ouverture uniquement (action, lot, produit) : une modification
  // synchronisée pendant la saisie (autre membre, confirmation serveur) n'efface rien.
  const openKey = action ? `${action}:${lot?.id ?? ''}:${product.id}` : '';
  useEffect(() => {
    if (!action) return;
    setLotId(lot?.id ?? '');
    setUnit(action === 'adjust' ? product.unit : product.packUnit && product.packSize && action === 'add' ? product.packUnit : product.unit);
    setExpiry(action === 'expiry' ? (lot?.expiryDate ?? '') : '');
    setExpiryKind(lot?.expiryKind ?? 'dlc');
    setLocationId(action === 'move' ? '' : (product.locationId ?? ''));
    setStoreId(product.defaultStoreId ?? '');
    setPrice('');
    setPurchase(false);
    setApprox(lot?.qtyApprox ?? false);
    setReason('count');
    setWaste(lot && lot.expiryDate && lot.expiryDate < new Date().toISOString().slice(0, 10) ? 'expired' : 'spoiled');
    setToList(true);
    // Portion type pour les masses et volumes (1 g n'aurait pas de sens) ; 1 pour les unités comptées.
    const portion = ({ g: 250, ml: 250, cl: 25, kg: 0.5, l: 0.5 } as Partial<Record<UnitCode, number>>)[product.unit] ?? 1;
    const base = action === 'adjust' ? (lot ? lot.quantity : total) : action === 'waste' || action === 'move' ? (lot?.quantity ?? portion) : action === 'add' && product.packUnit && product.packSize ? 1 : portion;
    setQty(String(roundQty(base)).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  if (!action) return null;
  const q = parseQty(qty);
  const name = product.name;
  const done = (ok: boolean) => {
    setBusy(false);
    if (ok) onClose();
  };
  const submit = async () => {
    setBusy(true);
    let ok = false;
    switch (action) {
      case 'consume': {
        if (!q || q <= 0) return done(false);
        ok = (await run('stock.consume', { productId: product.id, quantity: q, unit, lotId: lotId || null }, { success: `−${formatQty(q, unit)} · ${name}`, undoable: true })).ok;
        break;
      }
      case 'add': {
        if (!q || q <= 0) return done(false);
        const cents = price.trim() ? Math.round((parseQty(price) ?? NaN) * 100) : null;
        ok = (
          await run(
            'stock.add',
            {
              productId: product.id,
              lotId: newId(),
              quantity: q,
              unit,
              kind: purchase ? 'purchase' : 'add',
              expiryDate: expiry || null,
              expiryKind: expiry ? expiryKind : null,
              expirySource: expiry ? 'manual' : null,
              locationId: locationId || null,
              priceCents: cents != null && Number.isFinite(cents) ? cents : null,
              storeId: storeId || null,
              qtyApprox: approx,
            },
            { success: `+${formatQty(q, unit)} · ${name}`, undoable: true },
          )
        ).ok;
        break;
      }
      case 'adjust': {
        if (q == null || q < 0) return done(false);
        const expected = target ? target.quantity : total;
        ok = (
          await run(
            'stock.adjust',
            { productId: product.id, lotId: target?.id ?? null, expected, quantity: q, reason, approx },
            { success: `Quantité corrigée : ${approx ? '≈ ' : ''}${formatQty(q, product.unit)}` },
          )
        ).ok;
        break;
      }
      case 'waste': {
        if (!q || q <= 0) return done(false);
        ok = (await run('stock.waste', { productId: product.id, lotId: target?.id ?? null, quantity: q, unit, reason: waste }, { success: `${formatQty(q, unit)} jeté(s)`, undoable: true })).ok;
        break;
      }
      case 'move': {
        if (!target || !locationId) return done(false);
        ok = (await run('stock.move', { lotId: target.id, locationId, quantity: q && q < target.quantity ? q : null }, { success: 'Rangé' })).ok;
        break;
      }
      case 'open':
        ok = (await run('stock.open', { productId: product.id, lotId: target?.id ?? null }, { success: `${name} ouvert`, undoable: true })).ok;
        break;
      case 'finish':
        ok = (await run('stock.finish', { productId: product.id, lotId: target?.id ?? null, addToList: toList, itemId: newId() }, { success: `${name} terminé${toList ? ' et ajouté à la liste' : ''}`, undoable: true })).ok;
        break;
      case 'missing':
        ok = (await run('stock.reportMissing', { productId: product.id, itemId: newId() }, { success: `${name} ajouté à la liste de courses` })).ok;
        break;
      case 'expiry':
        if (!target) return done(false);
        ok = (await run('lot.update', { lotId: target.id, patch: { expiryDate: expiry || null, expiryKind: expiry ? expiryKind : null, expirySource: 'manual' } }, { success: 'Date enregistrée' })).ok;
        break;
    }
    done(ok);
  };

  const inStock = lots.filter((l) => l.quantity > 0);
  const stockQty = q != null && unit ? toStockUnit(q, unit, product) : null;
  const tooMuch = (action === 'consume' || action === 'waste') && stockQty != null && stockQty > (target ? target.quantity : total) + 1e-9;

  return (
    <Sheet
      open={!!action}
      onClose={onClose}
      title={`${TITLES[action]} · ${name}`}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Annuler</button>
          <button className={`btn ${action === 'waste' ? 'danger' : 'primary'}`} onClick={() => void submit()} disabled={busy} data-testid="action-submit">
            {action === 'finish' ? 'Terminé' : action === 'open' ? 'Ouvert' : action === 'missing' ? 'Ajouter à la liste' : 'Valider'}
          </button>
        </>
      }
    >
      {(action === 'consume' || action === 'waste' || action === 'add') && (
        <QtyInput value={qty} onChange={setQty} unit={unit} units={units} onUnit={setUnit} autoFocus />
      )}
      {action === 'adjust' && (
        <>
          <p className="small muted">
            Stock enregistré : <strong>{formatQty(target ? target.quantity : total, product.unit)}</strong>
            {target ? ' dans ce lot' : ''}. Indiquez la quantité réellement présente.
          </p>
          <QtyInput value={qty} onChange={setQty} unit={product.unit} label="Quantité réelle" autoFocus />
          <div className="row spread">
            <span>Quantité approximative (« il en reste environ… »)</span>
            <Switch label="Approximative" checked={approx} onChange={setApprox} />
          </div>
          <Field label="Motif">
            <select className="select" value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
              {(Object.keys(ADJUST_REASON_LABELS) as AdjustReason[]).map((r) => <option key={r} value={r}>{ADJUST_REASON_LABELS[r]}</option>)}
            </select>
          </Field>
        </>
      )}
      {(action === 'consume' || action === 'waste' || action === 'open') && !lot && inStock.length > 1 && (
        <LotPicker lots={inStock} product={product} value={lotId} onChange={setLotId} />
      )}
      {tooMuch && <div className="alert warning">C'est plus que le stock enregistré ({formatQty(target ? target.quantity : total, product.unit)}). Seul le stock restant sera retiré, et l'écart signalé.</div>}
      {action === 'waste' && (
        <Field label="Raison">
          <Segmented label="Raison" value={waste} onChange={setWaste} options={[{ value: 'expired', label: 'Périmé' }, { value: 'spoiled', label: 'Abîmé' }, { value: 'other', label: 'Autre' }]} />
        </Field>
      )}
      {action === 'add' && (
        <>
          <div className="grid-2">
            <Field label="Date de péremption" hint="Laissez vide si inconnue : aucune date n'est inventée.">
              <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </Field>
            {expiry && (
              <Field label="Type de date">
                <Segmented label="Type de date" value={expiryKind} onChange={setExpiryKind} options={[{ value: 'dlc', label: 'À consommer jusqu’au' }, { value: 'ddm', label: 'De préférence avant' }]} />
              </Field>
            )}
            <Field label="Emplacement">
              <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="row spread">
            <span>C'est un achat (enregistrer la dépense)</span>
            <Switch label="Achat" checked={purchase} onChange={setPurchase} />
          </div>
          {purchase && (
            <div className="grid-2">
              <Field label="Prix payé (total)" hint="Facultatif — jamais estimé à votre place.">
                <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ex. 2,35" />
              </Field>
              <Field label="Magasin">
                <select className="select" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  <option value="">—</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
          )}
          <div className="row spread">
            <span>Quantité approximative</span>
            <Switch label="Approximative" checked={approx} onChange={setApprox} />
          </div>
        </>
      )}
      {action === 'move' && (
        <>
          {!lot && <LotPicker lots={inStock} product={product} value={lotId} onChange={setLotId} allowAuto={false} />}
          <Field label="Nouvel emplacement">
            <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Choisir…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          {target && target.quantity > 1 && <QtyInput value={qty} onChange={setQty} unit={product.unit} label="Quantité à déplacer" />}
        </>
      )}
      {action === 'open' && (
        <p className="muted">
          {product.openShelfLifeDays != null
            ? `Après ouverture, ${name.toLowerCase()} se conserve ${product.openShelfLifeDays} jour(s) : la date limite sera ajustée.`
            : 'L’unité ouverte sera consommée en priorité. Astuce : indiquez la durée de conservation après ouverture dans la fiche du produit.'}
        </p>
      )}
      {action === 'finish' && (
        <>
          <p className="muted">{target ? 'Ce lot sera mis à zéro.' : `Tout le stock restant (${formatQty(total, product.unit)}) sera mis à zéro.`}</p>
          <div className="row spread">
            <span>Ajouter à la liste de courses</span>
            <Switch label="Ajouter à la liste" checked={toList} onChange={setToList} />
          </div>
        </>
      )}
      {action === 'missing' && <p className="muted">« {name} » sera ajouté à la liste de courses en priorité haute. Le stock enregistré n'est pas modifié : si besoin, corrigez-le ensuite.</p>}
      {action === 'expiry' && (
        <>
          <Field label="Date" hint="Effacez la date si elle est inconnue.">
            <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} autoFocus />
          </Field>
          {expiry && <Segmented label="Type de date" value={expiryKind} onChange={setExpiryKind} options={[{ value: 'dlc', label: 'À consommer jusqu’au' }, { value: 'ddm', label: 'De préférence avant' }]} />}
        </>
      )}
    </Sheet>
  );
}
