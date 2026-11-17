import { useState } from 'react';
import { Archive, Pencil, Plus, Tags } from 'lucide-react';
import { CATEGORY_ICONS, LOCATION_ICONS, STORE_COLORS, newId, type Category, type Location, type LocationKind, type Store } from '@homeos/shared';
import { useCatalog } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { Sheet } from '../../../ui/Sheet';
import { Field, TextField } from '../../../ui/Field';
import { Segmented } from '../../../ui/Controls';
import { NamedIcon } from '../../../ui/icons';

type Kind = 'category' | 'location' | 'store';
type Entry = Partial<Category & Location & Store> & { id: string; name: string };

const KIND_LABELS: Record<LocationKind, string> = { fridge: 'Réfrigérateur', freezer: 'Congélateur', pantry: 'Placard / cellier', other: 'Autre' };

export function CatalogSection() {
  const [tab, setTab] = useState<Kind>('category');
  const { categories, locations, stores } = useCatalog();
  const view = useView();
  const run = useRun();
  const canWrite = useCan('catalog.write');
  const [edit, setEdit] = useState<Entry | null>(null);
  const [isNew, setIsNew] = useState(false);
  const list: Entry[] = tab === 'category' ? categories : tab === 'location' ? locations : stores;
  const usage = (e: Entry) =>
    [...view.product.values()].filter((p) => !p.archived && (tab === 'category' ? p.categoryId === e.id : tab === 'location' ? p.locationId === e.id : p.defaultStoreId === e.id)).length;

  const open = (e?: Entry) => {
    setIsNew(!e);
    setEdit(e ?? { id: newId(), name: '', icon: tab === 'location' ? 'box' : 'package', color: STORE_COLORS[list.length % STORE_COLORS.length], kind: 'other', address: '', notes: '' });
  };
  const save = async () => {
    if (!edit || !edit.name.trim()) return;
    const ok =
      tab === 'category'
        ? (await run('category.upsert', { id: edit.id, name: edit.name.trim(), icon: edit.icon, color: edit.color }, { success: 'Catégorie enregistrée' })).ok
        : tab === 'location'
          ? (await run('location.upsert', { id: edit.id, name: edit.name.trim(), icon: edit.icon, kind: edit.kind as LocationKind }, { success: 'Emplacement enregistré' })).ok
          : (await run('store.upsert', { id: edit.id, name: edit.name.trim(), color: edit.color, address: edit.address?.trim() || null, notes: edit.notes?.trim() || null }, { success: 'Magasin enregistré' })).ok;
    if (ok) setEdit(null);
  };
  const archive = async (e: Entry) => {
    const op = tab === 'category' ? 'category.archive' : tab === 'location' ? 'location.archive' : 'store.archive';
    await run(op, { id: e.id, archived: true }, { success: `« ${e.name} » archivé` });
    setEdit(null);
  };
  const label = tab === 'category' ? 'catégorie' : tab === 'location' ? 'emplacement' : 'magasin';
  return (
    <section className="card" id="catalogue" style={{ marginBottom: 16 }}>
      <div className="card-title">
        <h3 className="row" style={{ ['--gap' as string]: '10px' }}><Tags size={20} /> Catalogue du foyer</h3>
        {canWrite && <button className="btn sm" onClick={() => open()}><Plus size={16} /> {tab === 'store' ? 'Magasin' : tab === 'location' ? 'Emplacement' : 'Catégorie'}</button>}
      </div>
      <Segmented label="Type" value={tab} onChange={setTab} options={[{ value: 'category', label: 'Catégories' }, { value: 'location', label: 'Emplacements' }, { value: 'store', label: 'Magasins' }]} />
      <div className="list" style={{ marginTop: 10 }}>
        {list.length === 0 && <div className="small muted" style={{ padding: 12 }}>Aucun {label} pour l'instant.</div>}
        {list.map((e) => (
          <button key={e.id} className="list-row" onClick={() => canWrite && open(e)} disabled={!canWrite}>
            <span className="thumb" style={{ width: 36, height: 36, ['--tint' as string]: e.color ?? 'var(--primary)' }}>
              {tab === 'store' ? <span className="dot" style={{ width: 12, height: 12, color: e.color }} /> : <NamedIcon name={e.icon} size={18} />}
            </span>
            <span className="meta">
              <span className="title" style={{ display: 'block' }}>{e.name}</span>
              <span className="sub">{usage(e)} produit(s){tab === 'location' && e.kind ? ` · ${KIND_LABELS[e.kind as LocationKind]}` : ''}{tab === 'store' && e.address ? ` · ${e.address}` : ''}</span>
            </span>
            {canWrite && <Pencil size={16} className="subtle" />}
          </button>
        ))}
      </div>
      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={isNew ? `Nouveau ${label}` : edit?.name}
        footer={
          <>
            {!isNew && edit && <button className="btn ghost" onClick={() => void archive(edit)}><Archive size={16} /> Archiver</button>}
            <button className="btn primary" disabled={!edit?.name.trim()} onClick={() => void save()}>Enregistrer</button>
          </>
        }
      >
        {edit && (
          <>
            <TextField label="Nom" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={120} autoFocus />
            {tab !== 'store' && (
              <Field label="Icône">
                <div className="choice-grid">
                  {(tab === 'category' ? CATEGORY_ICONS : LOCATION_ICONS).map((i) => (
                    <button type="button" key={i} className="choice" aria-pressed={edit.icon === i} onClick={() => setEdit({ ...edit, icon: i })} aria-label={i}><NamedIcon name={i} size={20} /></button>
                  ))}
                </div>
              </Field>
            )}
            {tab === 'location' && (
              <Field label="Type d'emplacement" hint="Le réfrigérateur déclenche plus tôt l'alerte « produit oublié ».">
                <select className="select" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as LocationKind })}>
                  {(Object.keys(KIND_LABELS) as LocationKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                </select>
              </Field>
            )}
            {tab !== 'location' && (
              <Field label="Couleur">
                <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
                  {[...STORE_COLORS, '#7A7F87', '#3B82C4', '#D0623A'].map((c) => (
                    <button type="button" key={c} className="swatch" aria-pressed={edit.color === c} style={{ background: c }} onClick={() => setEdit({ ...edit, color: c })} aria-label={`Couleur ${c}`} />
                  ))}
                </div>
              </Field>
            )}
            {tab === 'store' && (
              <>
                <TextField label="Adresse (facultatif)" value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} maxLength={200} />
                <Field label="Notes">
                  <textarea className="textarea" value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} maxLength={1000} />
                </Field>
              </>
            )}
          </>
        )}
      </Sheet>
    </section>
  );
}
