import { useEffect, useMemo, useState } from 'react';
import { Link2, PackagePlus, Search, WifiOff } from 'lucide-react';
import {
  DEFAULT_CATEGORIES, newId, normalizeName, similarity, type ExternalProduct, type ParsedCode, type Product,
} from '@homeos/shared';
import { get, ApiError } from '../../../lib/api';
import { useCatalog } from '../../../lib/hooks';
import { useRun, useView } from '../../../lib/sync/react';
import { Sheet } from '../../../ui/Sheet';
import { Field, TextField } from '../../../ui/Field';
import { Spinner } from '../../../ui/Controls';
import { UnitSelect } from '../inventory/ProductForm';
import type { UnitCode } from '@homeos/shared';

interface Lookup {
  status: 'found' | 'not_found' | 'unavailable' | 'invalid' | 'offline';
  product: ExternalProduct | null;
  imagePath: string | null;
}

/**
 * Code inconnu du foyer : recherche dans les bases ouvertes, proposition d'association
 * à un produit existant (jamais automatique), ou création rapide.
 */
export function IdentifySheet({ parsed, locationId, onResolved, onClose }: { parsed: ParsedCode | null; locationId: string | null; onResolved: (product: Product) => void; onClose: () => void }) {
  const view = useView();
  const run = useRun();
  const { categories, locations } = useCatalog();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unit, setUnit] = useState<UnitCode>('piece');
  const [loc, setLoc] = useState(locationId ?? '');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!parsed) return;
    setLookup(null);
    setName('');
    setBrand('');
    setSearch('');
    setUnit('piece');
    setCategoryId('');
    setLoc(locationId ?? '');
    let alive = true;
    get<Lookup>(`/api/barcode/${encodeURIComponent(parsed.code)}`)
      .then((r) => alive && setLookup(r))
      .catch((e) => alive && setLookup({ status: e instanceof ApiError && e.offline ? 'offline' : 'unavailable', product: null, imagePath: null }));
    return () => {
      alive = false;
    };
  }, [parsed]);

  useEffect(() => {
    const p = lookup?.product;
    if (!p) return;
    setName(p.name);
    setBrand(p.brand ?? '');
    const key = DEFAULT_CATEGORIES.find((c) => c.key === p.categoryKey)?.name;
    const cat = categories.find((c) => c.name === key);
    if (cat) setCategoryId(cat.id);
  }, [lookup, categories]);

  const products = useMemo(() => [...view.product.values()].filter((p) => !p.archived) as Product[], [view.product]);
  const suggestions = useMemo(() => {
    const ref = search.trim() || name.trim();
    if (ref.length < 2) return [];
    return products
      .map((p) => ({ p, s: normalizeName(p.name).includes(normalizeName(ref)) ? 0.95 : Math.max(similarity(p.name, ref), ...p.aliases.map((a) => similarity(a.text, ref))) }))
      .filter((x) => x.s >= 0.45)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);
  }, [products, search, name]);

  if (!parsed) return null;
  const ext = lookup?.product;

  const associate = async (p: Product) => {
    setBusy(true);
    const out = await run('productCode.add', { id: newId(), productId: p.id, code: parsed.code, packQty: 1, label: ext?.quantityText ?? null, brand: ext?.brand ?? null, source: ext?.source ?? 'manual' }, { success: `Code associé à « ${p.name} »` });
    setBusy(false);
    if (out.ok) onResolved(p);
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const id = newId();
    const out = await run(
      'product.create',
      {
        id,
        name: name.trim(),
        brand: brand.trim() || null,
        unit,
        categoryId: categoryId || null,
        locationId: loc || null,
        photoId: lookup?.imagePath ? `bc-${parsed.code}` : null,
        codes: [{ id: newId(), code: parsed.code, packQty: 1, label: ext?.quantityText ?? null, brand: brand.trim() || null, source: ext?.source ?? 'manual' }],
      },
      { success: `« ${name.trim()} » ajouté au catalogue` },
    );
    setBusy(false);
    if (out.ok) onResolved({ id, name: name.trim(), unit, packUnit: null, packSize: null } as Product);
  };

  return (
    <Sheet open={!!parsed} onClose={onClose} title="Nouveau code-barres">
      <div className="small muted">
        Code <strong className="num">{parsed.code}</strong>
        {parsed.restricted && ' · code magasin (poids ou prix variable) : il ne sera pas interprété.'}
      </div>
      {!lookup ? (
        <div className="row"><Spinner /> <span className="muted">Recherche dans les bases de produits ouvertes…</span></div>
      ) : ext ? (
        <div className="row card flat" style={{ padding: 12 }}>
          {lookup.imagePath && <img src={lookup.imagePath} alt="" width={64} height={64} style={{ borderRadius: 12, objectFit: 'cover', background: '#fff' }} />}
          <div>
            <div className="strong">{ext.name}</div>
            <div className="small muted">{[ext.brand, ext.quantityText].filter(Boolean).join(' · ')}</div>
            <div className="xsmall subtle">Source : {ext.source === 'off' ? 'Open Food Facts' : ext.source === 'obf' ? 'Open Beauty Facts' : 'Open Products Facts'} (ODbL)</div>
          </div>
        </div>
      ) : (
        <div className="alert info">
          {lookup.status === 'offline' ? <WifiOff size={18} /> : <Search size={18} />}
          <span>
            {lookup.status === 'offline' || lookup.status === 'unavailable'
              ? 'Recherche en ligne indisponible pour le moment : renseignez simplement le nom.'
              : 'Produit absent des bases ouvertes (fréquent pour les produits ménagers ou de marque distributeur) : renseignez simplement le nom.'}
          </span>
        </div>
      )}

      <TextField label="Nom" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus placeholder="Ex. Liquide vaisselle" />
      {suggestions.length > 0 && (
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          <div className="label">Est-ce l'un de vos produits ?</div>
          {suggestions.map(({ p, s }) => (
            <button key={p.id} className="option-card" style={{ padding: 12 }} onClick={() => void associate(p)} disabled={busy}>
              <span className="oc-icon" style={{ width: 36, height: 36 }}><Link2 size={18} /></span>
              <span>
                <span className="strong">{p.name}</span>
                <br />
                <span className="xsmall muted">{s >= 0.9 ? 'Très ressemblant' : 'Ressemblant'} — associer ce code (aucune association automatique)</span>
              </span>
            </button>
          ))}
        </div>
      )}


      <div className="grid-2">
        <TextField label="Marque" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={80} />
        <Field label="Catégorie">
          <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Emplacement" hint="Où ce produit est-il rangé ?">
          <select className="select" value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">—</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Compté en" hint={ext?.quantityText ? `Format : ${ext.quantityText}` : 'Un scan = 1 de cette unité.'}>
          <UnitSelect value={unit} onChange={(u) => u && setUnit(u)} />
        </Field>
      </div>
      <button className="btn primary lg block" onClick={() => void create()} disabled={busy || !name.trim()}><PackagePlus size={19} /> Créer et continuer</button>
      <TextField label="Ou associer à un autre de vos produits" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" />
    </Sheet>
  );
}
