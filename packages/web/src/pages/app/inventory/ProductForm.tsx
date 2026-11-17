import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronDown, AlertTriangle, ImageOff } from 'lucide-react';
import {
  UNIT_GROUPS, UNITS, newId, normalizeName, similarity, unitLabel, type Product, type UnitCode,
} from '@homeos/shared';
import { useCatalog, useHousehold, useProducts, parseQty, photoUrl } from '../../../lib/hooks';
import { useEngine, useRun } from '../../../lib/sync/react';
import { errorMessage, post } from '../../../lib/api';
import { toast } from '../../../lib/toast';
import { Field, TextField } from '../../../ui/Field';
import { Switch } from '../../../ui/Controls';

/** Réduit une photo à 640 px (JPEG) avant l'envoi : rapide et léger. */
export async function resizeImage(file: File, max = 640): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export function UnitSelect({ value, onChange, id, allowEmpty }: { value: UnitCode | ''; onChange: (u: UnitCode | '') => void; id?: string; allowEmpty?: boolean }) {
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as UnitCode | '')}>
      {allowEmpty && <option value="">Aucun</option>}
      {UNIT_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.units.map((u) => <option key={u} value={u}>{UNITS[u].short ? `${UNITS[u].singular} (${UNITS[u].short})` : UNITS[u].singular}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

(UnitSelect as unknown as { fieldControl: boolean }).fieldControl = true;

interface FormState {
  name: string;
  brand: string;
  categoryId: string;
  locationId: string;
  unit: UnitCode;
  packUnit: UnitCode | '';
  packSize: string;
  minQty: string;
  idealQty: string;
  defaultStoreId: string;
  openShelfLifeDays: string;
  notes: string;
  trackStock: boolean;
  family: string;
  barcode: string;
  initialQty: string;
  initialExpiry: string;
  initialApprox: boolean;
}

const num = (s: string) => (s.trim() ? parseQty(s) : null);

export function ProductForm({ product, onDone, initialName = '', initialCode = '' }: { product?: Product; onDone: (id: string) => void; initialName?: string; initialCode?: string }) {
  const run = useRun();
  const engine = useEngine();
  const navigate = useNavigate();
  const { id: hid } = useHousehold();
  const { categories, locations, stores } = useCatalog();
  const products = useProducts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoId, setPhotoId] = useState<string | null>(product?.photoId ?? null);
  const [uploading, setUploading] = useState(false);
  const [more, setMore] = useState(!!product);
  const [f, setF] = useState<FormState>(() => ({
    name: product?.name ?? initialName,
    brand: product?.brand ?? '',
    categoryId: product?.categoryId ?? categories[0]?.id ?? '',
    locationId: product?.locationId ?? '',
    unit: product?.unit ?? 'piece',
    packUnit: product?.packUnit ?? '',
    packSize: product?.packSize != null ? String(product.packSize).replace('.', ',') : '',
    minQty: product?.minQty != null ? String(product.minQty).replace('.', ',') : '',
    idealQty: product?.idealQty != null ? String(product.idealQty).replace('.', ',') : '',
    defaultStoreId: product?.defaultStoreId ?? '',
    openShelfLifeDays: product?.openShelfLifeDays != null ? String(product.openShelfLifeDays) : '',
    notes: product?.notes ?? '',
    trackStock: product?.trackStock ?? true,
    family: product?.family ?? '',
    barcode: initialCode,
    initialQty: '',
    initialExpiry: '',
    initialApprox: false,
  }));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  // Doublons probables : signalés, jamais fusionnés automatiquement.
  const similar = useMemo(() => {
    const n = f.name.trim();
    if (n.length < 3) return [];
    return products.filter(
      (p) => p.id !== product?.id && !p.archived && (normalizeName(p.name) === normalizeName(n) || similarity(p.name, n) >= 0.8 || p.aliases.some((a) => normalizeName(a.text) === normalizeName(n))),
    );
  }, [f.name, products, product?.id]);

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const dataUrl = await resizeImage(file);
      const r = await post<{ id: string }>(`/api/households/${hid}/photos`, { dataUrl });
      setPhotoId(r.id);
    } catch (e) {
      toast(`Photo : ${errorMessage(e)}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const common = {
      name: f.name.trim(),
      brand: f.brand.trim() || null,
      family: f.family.trim() || null,
      categoryId: f.categoryId || null,
      locationId: f.locationId || null,
      minQty: num(f.minQty),
      idealQty: num(f.idealQty),
      packUnit: f.packUnit || null,
      packSize: f.packUnit ? num(f.packSize) : null,
      defaultStoreId: f.defaultStoreId || null,
      openShelfLifeDays: f.openShelfLifeDays.trim() ? Math.round(Number(f.openShelfLifeDays)) : null,
      notes: f.notes.trim() || null,
      trackStock: f.trackStock,
      photoId,
    };
    if (product) {
      const out = await run('product.update', { id: product.id, patch: { ...common, unit: f.unit }, baseVersion: engine.confirmedVersion('product', product.id) }, { success: 'Produit enregistré' });
      if (out.ok) onDone(product.id);
      return;
    }
    const id = newId();
    const q = num(f.initialQty);
    const out = await run(
      'product.create',
      {
        id,
        ...common,
        unit: f.unit,
        codes: f.barcode.trim() ? [{ id: newId(), code: f.barcode.trim(), packQty: 1, source: 'manual' }] : undefined,
        initialStock: q && q > 0 ? { lotId: newId(), quantity: q, unit: f.unit, expiryDate: f.initialExpiry || null, expirySource: f.initialExpiry ? 'manual' : null, qtyApprox: f.initialApprox, locationId: f.locationId || null } : null,
      },
      { success: `« ${common.name} » ajouté` },
    );
    if (out.ok) onDone(id);
  };

  const canSave = f.name.trim().length > 0 && (!f.packUnit || (num(f.packSize) ?? 0) > 0);
  const img = photoUrl(hid, photoId);

  return (
    <form
      className="stack"
      style={{ ['--gap' as string]: '16px' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void submit();
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <button type="button" className="photo-pick" onClick={() => fileRef.current?.click()} aria-label="Ajouter une photo" disabled={uploading}>
          {img ? <img src={img} alt="" /> : uploading ? <span className="spinner" /> : <Camera size={24} />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} />
        <div className="grow stack" style={{ ['--gap' as string]: '10px' }}>
          <TextField label="Nom du produit" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} autoFocus={!product} placeholder="Ex. Lait demi-écrémé" />
          {photoId && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPhotoId(null)}><ImageOff size={15} /> Retirer la photo</button>}
        </div>
      </div>
      {similar.length > 0 && (
        <div className="alert warning" data-testid="duplicate-warning">
          <AlertTriangle size={18} />
          <span>
            Produit proche déjà présent : {similar.slice(0, 3).map((p, i) => (
              <span key={p.id}>{i > 0 && ', '}<a href={`/inventaire/${p.id}`} onClick={(e) => { e.preventDefault(); navigate(`/inventaire/${p.id}`); }}>« {p.name} »</a></span>
            ))}
            . S'il s'agit du même article, utilisez sa fiche plutôt que d'en créer un doublon.
          </span>
        </div>
      )}
      <div className="grid-2">
        <Field label="Catégorie (rayon)">
          <select className="select" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Emplacement habituel">
          <select className="select" value={f.locationId} onChange={(e) => set('locationId', e.target.value)}>
            <option value="">—</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Unité de stock" hint={product ? "Modifiable tant que le produit n'a aucun historique." : 'Ex. bouteille, g, unité…'}>
          <UnitSelect value={f.unit} onChange={(u) => u && set('unit', u)} />
        </Field>
        <Field label="Seuil minimal" hint={`Alerte dès qu'il reste ${f.minQty || '…'} ${unitLabel(f.unit, 2)} ou moins.`}>
          <input className="input" inputMode="decimal" value={f.minQty} onChange={(e) => set('minQty', e.target.value)} placeholder="Facultatif" />
        </Field>
        <Field label="Quantité idéale" hint="Quantité visée après les courses.">
          <input className="input" inputMode="decimal" value={f.idealQty} onChange={(e) => set('idealQty', e.target.value)} placeholder="Facultatif" />
        </Field>
      </div>
      {!product && (
        <div className="card flat" style={{ padding: 16, background: 'var(--surface-2)' }}>
          <div className="strong" style={{ marginBottom: 10 }}>Stock actuel (facultatif)</div>
          <div className="grid-2">
            <Field label={`Quantité (${unitLabel(f.unit, 2)})`}>
              <input className="input" inputMode="decimal" value={f.initialQty} onChange={(e) => set('initialQty', e.target.value)} placeholder="Ex. 2 ou 0,5" />
            </Field>
            <Field label="Date de péremption" hint="Laissez vide si inconnue.">
              <input className="input" type="date" value={f.initialExpiry} onChange={(e) => set('initialExpiry', e.target.value)} />
            </Field>
          </div>
          <div className="row spread" style={{ marginTop: 10 }}>
            <span className="small">Quantité approximative</span>
            <Switch label="Approximative" checked={f.initialApprox} onChange={(v) => set('initialApprox', v)} />
          </div>
        </div>
      )}
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(!more)} aria-expanded={more}>
        <ChevronDown size={16} style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform 200ms' }} /> Plus d'options
      </button>
      {more && (
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="grid-2">
            <TextField label="Marque" value={f.brand} onChange={(e) => set('brand', e.target.value)} maxLength={80} />
            <TextField label="Famille (variantes)" value={f.family} onChange={(e) => set('family', e.target.value)} placeholder="Ex. Yaourts" maxLength={80} />
            <Field label="Conditionnement d'achat" hint="Ex. paquet de 500 g : permet de saisir « 2 paquets ».">
              <div className="row" style={{ ['--gap' as string]: '8px' }}>
                <UnitSelect value={f.packUnit} onChange={(u) => set('packUnit', u)} allowEmpty />
                {f.packUnit && (
                  <input className="input" style={{ maxWidth: 120 }} inputMode="decimal" value={f.packSize} onChange={(e) => set('packSize', e.target.value)} placeholder={`en ${unitLabel(f.unit, 2)}`} aria-label="Contenu du conditionnement" />
                )}
              </div>
            </Field>
            <Field label="Magasin habituel">
              <select className="select" value={f.defaultStoreId} onChange={(e) => set('defaultStoreId', e.target.value)}>
                <option value="">—</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Conservation après ouverture (jours)">
              <input className="input" type="number" min={0} max={3650} value={f.openShelfLifeDays} onChange={(e) => set('openShelfLifeDays', e.target.value)} placeholder="Ex. 3" />
            </Field>
            {!product && <TextField label="Code-barres" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} inputMode="numeric" placeholder="Facultatif" />}
          </div>
          <Field label="Commentaires">
            <textarea className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
          </Field>
          <div className="row spread">
            <span>
              Suivre pour le réapprovisionnement
              <br />
              <span className="xsmall subtle">Désactivez pour les produits achetés occasionnellement.</span>
            </span>
            <Switch label="Suivi du réapprovisionnement" checked={f.trackStock} onChange={(v) => set('trackStock', v)} />
          </div>
        </div>
      )}
      <button className="btn primary lg block" disabled={!canSave}>{product ? 'Enregistrer' : 'Ajouter le produit'}</button>
    </form>
  );
}
