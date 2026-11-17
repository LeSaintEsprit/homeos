import { useMemo, useState } from 'react';
import { CalendarClock, Link2, PackageCheck, PackagePlus, PackageX, Undo2 } from 'lucide-react';
import {
  addDays, compatibleUnits, formatMoney, formatQty, newId, normalizeName, parseEuros, similarity,
  type Product, type ShoppingItem, type UnitCode,
} from '@homeos/shared';
import { useCatalog, useHousehold, useToday, parseQty } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { formatShortDate } from '../../../lib/format';
import { EmptyState, Segmented } from '../../../ui/Controls';
import { Field } from '../../../ui/Field';
import { useConfirm } from '../../../ui/Confirm';
import { QtyInput } from '../inventory/ActionSheets';

type Link = { kind: 'product'; id: string } | { kind: 'create' } | { kind: 'skip' };

/** Fiche de réception d'un article acheté : ce qui a réellement été rapporté. */
function ReceiveCard({ item }: { item: ShoppingItem }) {
  const view = useView();
  const run = useRun();
  const today = useToday();
  const { currency } = useHousehold();
  const { locations, stores } = useCatalog();
  const products = useMemo(() => [...view.product.values()].filter((p) => !p.archived) as Product[], [view.product]);
  const linked = item.productId ? (view.product.get(item.productId) as Product | undefined) : undefined;
  const guess = useMemo(() => {
    if (linked) return null;
    const best = products.map((p) => ({ p, s: normalizeName(p.name) === normalizeName(item.name) ? 1 : similarity(p.name, item.name) })).sort((a, b) => b.s - a.s)[0];
    return best && best.s >= 0.6 ? best.p : null;
  }, [linked, products, item.name]);
  const [link, setLink] = useState<Link>(linked ? { kind: 'product', id: linked.id } : { kind: 'create' });
  const product = link.kind === 'product' ? (view.product.get(link.id) as Product | undefined) : undefined;
  const [qty, setQty] = useState(String(item.purchasedQty).replace('.', ','));
  const [unit, setUnit] = useState<UnitCode>(item.unit);
  const [price, setPrice] = useState(item.priceCents != null ? (item.priceCents / 100).toFixed(2).replace('.', ',') : '');
  const [expiry, setExpiry] = useState('');
  const [expirySource, setExpirySource] = useState<'manual' | 'estimated'>('manual');
  const [expiryKind, setExpiryKind] = useState<'dlc' | 'ddm'>('dlc');
  const [locationId, setLocationId] = useState(linked?.locationId ?? '');
  const [storeId, setStoreId] = useState(item.storeId ?? '');
  const [busy, setBusy] = useState(false);
  const units = product ? compatibleUnits(product) : [item.unit];
  const q = parseQty(qty);
  const diff = q != null ? q - item.purchasedQty : 0;
  const suggestedExpiry = product?.defaultShelfLifeDays ? addDays(today, product.defaultShelfLifeDays) : null;

  const receive = async (receivedQty: number) => {
    setBusy(true);
    const cents = price.trim() ? parseEuros(price) : null;
    const createId = newId();
    await run(
      'shopping.receive',
      {
        itemId: item.id,
        receivedQty,
        unit,
        totalCents: cents,
        storeId: storeId || null,
        date: today,
        lotId: newId(),
        purchaseId: newId(),
        expiryDate: expiry || null,
        expirySource: expiry ? expirySource : null,
        expiryKind: expiry ? expiryKind : null,
        locationId: locationId || null,
        productId: link.kind === 'product' ? link.id : null,
        createProduct: link.kind === 'create' ? { id: createId, name: item.name, unit: item.unit, categoryId: item.categoryId, locationId: locationId || null } : null,
        skipStock: link.kind === 'skip',
      },
      { success: receivedQty > 0 ? `« ${item.name} » rangé${link.kind === 'skip' ? ' (dépense seule)' : ' dans le stock'}` : `« ${item.name} » remis à acheter` },
    );
    setBusy(false);
  };

  return (
    <div className="card receive-card" data-testid="receive-card">
      <div className="row spread">
        <div>
          <div className="strong">{item.name}</div>
          <div className="small muted">
            Acheté : <span className="num">{formatQty(item.purchasedQty, item.unit)}</span>
            {item.purchasedQty < item.quantity && <> sur <span className="num">{formatQty(item.quantity, item.unit)}</span> demandés</>}
          </div>
        </div>
        <button className="btn ghost sm" onClick={() => void receive(0)} disabled={busy} title="L'article n'a finalement pas été acheté"><Undo2 size={15} /> Pas acheté</button>
      </div>

      {!linked && (
        <Field label="Produit dans le stock">
          <select
            className="select"
            value={link.kind === 'product' ? link.id : link.kind}
            onChange={(e) => {
              const v = e.target.value;
              const next: Link = v === 'create' || v === 'skip' ? { kind: v } : { kind: 'product', id: v };
              setLink(next);
              if (next.kind === 'product') {
                const p = view.product.get(next.id) as Product | undefined;
                if (p?.locationId) setLocationId(p.locationId);
              }
            }}
          >
            <option value="create">Créer « {item.name} » dans l'inventaire</option>
            {guess && <option value={guess.id}>Ressemble à « {guess.name} » — l'associer</option>}
            <optgroup label="Associer à un produit existant">
              {products.filter((p) => p.id !== guess?.id).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
            <option value="skip">Ne pas suivre en stock (dépense seulement)</option>
          </select>
        </Field>
      )}

      <QtyInput value={qty} onChange={setQty} unit={unit} units={units} onUnit={setUnit} label="Quantité réellement rapportée" />
      {q != null && unit === item.unit && Math.abs(diff) > 1e-9 && (
        <div className={`alert ${diff < 0 ? 'warning' : 'info'}`} data-testid="receive-diff">
          {diff < 0
            ? `Écart : ${formatQty(-diff, item.unit)} de moins que coché.`
            : `Écart : ${formatQty(diff, item.unit)} de plus que coché.`}
          {q < item.quantity && ` Il restera ${formatQty(item.quantity - q, item.unit)} à acheter dans la liste.`}
        </div>
      )}

      <div className="grid-2 always">
        <Field label={`Prix payé (total, ${currency === 'EUR' ? '€' : currency})`} hint={price.trim() ? undefined : 'Facultatif'}>
          <input className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" />
        </Field>
        <Field label="Magasin">
          <select className="select" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">—</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {link.kind !== 'skip' && (
          <Field label="Rangé dans">
            <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">—</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        )}
        {link.kind !== 'skip' && (
          <Field label="Date de péremption" hint={expiry && expirySource === 'estimated' ? 'Estimée — modifiable' : 'Facultative'}>
            <input className="input" type="date" value={expiry} onChange={(e) => { setExpiry(e.target.value); setExpirySource('manual'); }} />
          </Field>
        )}
      </div>
      {link.kind !== 'skip' && !expiry && suggestedExpiry && (
        <button className="chip" onClick={() => { setExpiry(suggestedExpiry); setExpirySource('estimated'); }}>
          <CalendarClock size={14} /> Proposer le {formatShortDate(suggestedExpiry)} (conservation habituelle de {product!.defaultShelfLifeDays} j)
        </button>
      )}
      {expiry && <Segmented label="Type de date" value={expiryKind} onChange={setExpiryKind} options={[{ value: 'dlc', label: 'À consommer jusqu’au' }, { value: 'ddm', label: 'De préférence avant' }]} />}

      <button className="btn primary block wrap" disabled={busy || q == null || q <= 0} onClick={() => q != null && void receive(q)} data-testid="receive-btn">
        {link.kind === 'skip' ? <PackageX size={18} /> : link.kind === 'create' ? <PackagePlus size={18} /> : <PackageCheck size={18} />}
        {link.kind === 'skip' ? 'Enregistrer la dépense' : 'Ranger dans le stock'}
        {q != null && q > 0 && <span className="num" style={{ opacity: 0.8 }}>· {formatQty(q, unit)}</span>}
        {price.trim() && parseEuros(price) != null && <span className="num" style={{ opacity: 0.8 }}>· {formatMoney(parseEuros(price), currency)}</span>}
      </button>
      {link.kind === 'product' && !linked && <div className="xsmall subtle"><Link2 size={12} style={{ verticalAlign: '-2px' }} /> L'article sera rattaché à ce produit.</div>}
    </div>
  );
}

export function ReceptionTab() {
  const view = useView();
  const run = useRun();
  const { ask, node } = useConfirm();
  const today = useToday();
  const canWrite = useCan('purchase.write');
  const items = useMemo(
    () => ([...view.shoppingItem.values()] as ShoppingItem[]).filter((i) => (i.status === 'purchased' || i.status === 'partial') && i.purchasedQty > 0).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [view.shoppingItem],
  );
  if (!items.length) {
    return <EmptyState icon={<PackageCheck size={28} />} title="Rien à réceptionner">Les articles cochés pendant les courses apparaîtront ici pour être rangés dans le stock, avec les quantités réellement rapportées.</EmptyState>;
  }
  if (!canWrite) return <div className="alert info">Votre rôle ne permet pas d'enregistrer la réception des courses.</div>;
  // Rangement express : uniquement les articles liés à un produit, avec les quantités cochées.
  const linked = items.filter((i) => i.productId && view.product.get(i.productId));
  const receiveAll = async () => {
    const ok = await ask(
      `Ranger ${linked.length} article(s) ?`,
      'Les quantités cochées seront ajoutées au stock, sans date de péremption ni prix supplémentaires. Les articles non rattachés à un produit restent à traiter un par un.',
      'Tout ranger',
    );
    if (!ok) return;
    for (const i of linked) {
      const p = view.product.get(i.productId!) as Product;
      await run('shopping.receive', { itemId: i.id, receivedQty: i.purchasedQty, unit: i.unit, totalCents: i.priceCents, storeId: i.storeId, date: today, lotId: newId(), purchaseId: newId(), locationId: p.locationId });
    }
  };
  return (
    <div className="stack">
      <div className="row spread">
        <span className="small muted">Vérifiez ce qui a réellement été rapporté : le stock n'est mis à jour qu'ici.</span>
        {linked.length > 1 && <button className="btn sm soft" onClick={() => void receiveAll()} data-testid="receive-all">Tout ranger</button>}
      </div>
      {items.map((i) => <ReceiveCard key={i.id} item={i} />)}
      {node}
    </div>
  );
}
