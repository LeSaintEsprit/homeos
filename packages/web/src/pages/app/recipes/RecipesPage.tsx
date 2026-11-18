import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, Check, ChefHat, CircleAlert, CircleHelp, Clock, Minus, Pencil, Plus, ShoppingCart, Trash2, X } from 'lucide-react';
import {
  checkRecipe, checkRecipes, compatibleUnits, formatQty, fromStockUnit, newId, normalizeName,
  type IngredientCheck, type Lot, type Product, type Recipe, type RecipeCheck, type RecipeIngredient, type ShoppingItem, type UnitCode,
} from '@homeos/shared';
import { parseQty, useHousehold, useProducts, useToday } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { formatShortDate } from '../../../lib/format';
import { toast } from '../../../lib/toast';
import { EmptyState, Segmented, Switch } from '../../../ui/Controls';
import { Field, TextField } from '../../../ui/Field';
import { useConfirm } from '../../../ui/Confirm';
import { PageHead } from '../Shell';
import { UnitSelect } from '../inventory/ProductForm';

function useRecipeContext() {
  const view = useView();
  const today = useToday();
  const { tz } = useHousehold();
  const products = useProducts();
  return useMemo(
    () => ({ products, lots: [...view.lot.values()] as Lot[], items: [...view.shoppingItem.values()] as ShoppingItem[], today, tz }),
    [products, view.lot, view.shoppingItem, today, tz],
  );
}

export function statusLabel(c: RecipeCheck, short = false): string {
  if (c.status === 'ready') return 'Réalisable';
  if (short) return `${c.missingCount} manquant${c.missingCount > 1 ? 's' : ''}`;
  return `Il manque ${c.missingCount} ingrédient${c.missingCount > 1 ? 's' : ''}`;
}

/** « 4 Œufs » plutôt que « 4 unités Œufs » ; « 250 g Farine » sinon. */
function ingredientQty(qty: number, unit: UnitCode): string {
  return unit === 'piece' ? formatQty(qty, unit).replace(/\s.*$/, '') : formatQty(qty, unit);
}

const TONE = { ready: 'success', almost: 'warning', missing: 'danger' } as const;

/** Liste des recettes, classées par faisabilité avec le stock actuel. */
export function RecipesPage() {
  const view = useView();
  const navigate = useNavigate();
  const canWrite = useCan('recipe.write');
  const ctx = useRecipeContext();
  const [filter, setFilter] = useState<'all' | 'ready' | 'urgent'>('all');
  const checks = useMemo(() => checkRecipes([...view.recipe.values()] as Recipe[], ctx), [view.recipe, ctx]);
  const shown = checks.filter((c) => filter === 'all' || (filter === 'ready' ? c.status === 'ready' : c.urgentCount > 0));
  const ready = checks.filter((c) => c.status === 'ready').length;
  const urgent = checks.filter((c) => c.urgentCount > 0).length;
  return (
    <>
      <PageHead
        title="Recettes"
        eyebrow={<Link to="/inventaire" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Inventaire</Link>}
        actions={canWrite && <button className="btn primary" onClick={() => navigate('/recettes/nouvelle')} data-testid="new-recipe"><Plus size={18} /> Recette</button>}
      />
      {checks.length === 0 ? (
        <EmptyState
          icon={<ChefHat size={28} />}
          title="Aucune recette"
          action={canWrite && <button className="btn primary" onClick={() => navigate('/recettes/nouvelle')}><Plus size={18} /> Ajouter une recette</button>}
        >
          Enregistrez vos recettes habituelles : HOMEOS indique celles que vous pouvez préparer avec ce que vous avez, celles qui utilisent des produits à consommer vite, et ajoute les ingrédients manquants à la liste.
        </EmptyState>
      ) : (
        <>
          <Segmented
            label="Afficher"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `Toutes (${checks.length})` },
              { value: 'ready', label: `Réalisables (${ready})` },
              { value: 'urgent', label: `Anti-gaspi (${urgent})` },
            ]}
          />
          {shown.length === 0 ? (
            <div className="card small muted" style={{ marginTop: 12 }}>
              {filter === 'ready' ? 'Aucune recette réalisable avec le stock actuel.' : 'Aucune recette n’utilise de produit à consommer dans les 3 prochains jours.'}
            </div>
          ) : (
            <div className="card pad-0" style={{ marginTop: 12 }}>
              {shown.map((c) => {
                const urgentNames = c.lines.filter((l) => l.urgent && l.product).map((l) => l.product!.name);
                return (
                  <button key={c.recipe.id} className="list-row" onClick={() => navigate(`/recettes/${c.recipe.id}`)} data-testid="recipe-row">
                    <span className="thumb" style={{ width: 42, height: 42 }}><ChefHat size={20} /></span>
                    <span className="meta">
                      <span className="title" style={{ display: 'block' }}>{c.recipe.name}</span>
                      <span className="sub">
                        {c.recipe.servings} part{c.recipe.servings > 1 ? 's' : ''} · {c.recipe.ingredients.length} ingrédient{c.recipe.ingredients.length > 1 ? 's' : ''}
                        {urgentNames.length > 0 && <> · <span className="warning-text">utilise {urgentNames.slice(0, 2).join(', ')} (à consommer vite)</span></>}
                      </span>
                    </span>
                    <span className={`badge ${TONE[c.status]}`} data-testid="recipe-status" title={statusLabel(c)}>{statusLabel(c, true)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Quantité exprimée dans l'unité de la recette (plus parlant : « 50 g » plutôt que « 0,05 kg »). */
function inRecipeUnit(stockQty: number, l: IngredientCheck): string {
  const p = l.product!;
  const q = fromStockUnit(stockQty, l.ingredient.unit, p);
  return q != null ? formatQty(q, l.ingredient.unit) : formatQty(stockQty, p.unit);
}

function lineText(l: IngredientCheck): string {
  const p = l.product;
  if (l.status === 'unknown') return 'Non suivi dans l’inventaire : à vérifier';
  if (!p) return '';
  if (l.status === 'unconvertible') return `Unité incompatible avec le stock (${formatQty(l.available, p.unit)} en stock)`;
  const stock = `${formatQty(l.available, p.unit)} en stock`;
  if (l.status === 'ok') return stock;
  const onList = l.onList > 0 ? ` · ${formatQty(l.onList, p.unit)} déjà dans la liste` : '';
  return `Il manque ${inRecipeUnit(l.missing, l)} · ${stock}${onList}`;
}

function LineIcon({ l }: { l: IngredientCheck }) {
  if (l.status === 'ok') return <Check size={18} className="success-text" aria-label="Disponible" />;
  if (l.status === 'unknown' || l.status === 'unconvertible') return <CircleHelp size={18} className="subtle" aria-label="À vérifier" />;
  return <CircleAlert size={18} className={l.status === 'partial' ? 'warning-text' : 'danger-text'} aria-label={l.status === 'partial' ? 'Insuffisant' : 'Manquant'} />;
}

/** Détail : ingrédients comparés au stock, parts ajustables, manquants vers la liste, « cuisiner ». */
export function RecipeDetailPage() {
  const { id = '' } = useParams();
  const view = useView();
  const run = useRun();
  const navigate = useNavigate();
  const canWrite = useCan('recipe.write');
  const canShop = useCan('shopping.write');
  const canStock = useCan('stock.write');
  const ctx = useRecipeContext();
  const confirm = useConfirm();
  const recipe = view.recipe.get(id) as Recipe | undefined;
  const [servings, setServings] = useState<number | null>(null);
  const parts = servings ?? recipe?.servings ?? 1;
  const check = useMemo(() => (recipe ? checkRecipe(recipe, parts, ctx) : null), [recipe, parts, ctx]);
  if (!recipe || !check) return <EmptyState icon={<ChefHat size={28} />} title="Recette introuvable" action={<Link className="btn" to="/recettes">Retour</Link>} />;

  const addMissing = async () => {
    let n = 0;
    for (const need of check.toBuy) {
      const out = await run('shopping.add', { itemId: newId(), productId: need.productId, name: need.name, quantity: need.quantity, unit: need.unit, comment: `Recette « ${recipe.name} »`, source: 'recipe' });
      if (out.ok) n++;
    }
    if (n) {
      toast(`${n} ingrédient${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} à la liste`, 'success');
    }
  };

  const cook = async () => {
    const used = check.lines.filter((l) => l.product && l.status !== 'unconvertible' && l.available > 0);
    const body = (
      <div className="stack" style={{ ['--gap' as string]: '8px' }}>
        <div>Le stock sera diminué de :</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {used.map((l) => <li key={l.ingredient.name}>{l.product!.name} : {inRecipeUnit(Math.min(l.neededStock ?? 0, l.available), l)}</li>)}
        </ul>
        {check.status !== 'ready' && <div className="warning-text">Certains ingrédients manquent : seul le stock disponible sera déduit.</div>}
      </div>
    );
    if (!(await confirm.ask(`Cuisiner « ${recipe.name} » (${parts} part${parts > 1 ? 's' : ''}) ?`, body, 'Cuisiner'))) return;
    await run('recipe.cook', { recipeId: recipe.id, servings: parts }, { success: `« ${recipe.name} » cuisiné : stock mis à jour`, undoable: true });
  };

  const archive = async () => {
    if (!(await confirm.ask('Archiver cette recette ?', 'Elle n’apparaîtra plus dans la liste. Le stock n’est pas modifié.', 'Archiver'))) return;
    const out = await run('recipe.archive', { id: recipe.id, archived: true }, { success: 'Recette archivée' });
    if (out.ok) navigate('/recettes');
  };

  const required = check.lines.filter((l) => !l.ingredient.optional);
  const optional = check.lines.filter((l) => l.ingredient.optional);
  const renderLines = (lines: IngredientCheck[]) => (
    <div className="card pad-0">
      {lines.map((l, i) => (
        <div key={`${l.ingredient.name}-${i}`} className="list-row" data-testid="ingredient-row" data-status={l.status}>
          <LineIcon l={l} />
          <span className="meta">
            <span className="title" style={{ display: 'block' }}>
              <span className="num">{ingredientQty(l.needed, l.ingredient.unit)}</span> {l.ingredient.name}
              {l.product && normalizeName(l.product.name) !== normalizeName(l.ingredient.name) && <span className="subtle"> ({l.product.name})</span>}
            </span>
            <span className="sub">
              {lineText(l)}
              {l.urgent && l.soonestExpiry && <> · <span className="warning-text"><Clock size={12} /> à consommer avant le {formatShortDate(l.soonestExpiry)}</span></>}
            </span>
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <PageHead
        title={recipe.name}
        eyebrow={<Link to="/recettes" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Recettes</Link>}
        actions={canWrite && <>
          <button className="btn ghost icon" onClick={() => navigate(`/recettes/${recipe.id}/modifier`)} aria-label="Modifier la recette"><Pencil size={18} /></button>
          <button className="btn ghost icon" onClick={() => void archive()} aria-label="Archiver la recette"><Archive size={18} /></button>
        </>}
      />
      <div className="card row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ ['--gap' as string]: '10px' }}>
          <span className="small muted">Parts</span>
          <button className="btn icon sm" onClick={() => setServings(Math.max(1, parts - 1))} disabled={parts <= 1} aria-label="Une part de moins"><Minus size={16} /></button>
          <strong className="num" data-testid="servings">{parts}</strong>
          <button className="btn icon sm" onClick={() => setServings(Math.min(100, parts + 1))} aria-label="Une part de plus"><Plus size={16} /></button>
        </div>
        <span className={`badge ${TONE[check.status]}`} data-testid="recipe-status">{statusLabel(check)}</span>
      </div>

      <div className="section-title">Ingrédients</div>
      {renderLines(required)}
      {optional.length > 0 && <>
        <div className="section-title">Facultatifs</div>
        {renderLines(optional)}
      </>}

      <div className="row wrap" style={{ marginTop: 14 }}>
        {canShop && (
          <button className="btn wrap" onClick={() => void addMissing()} disabled={check.toBuy.length === 0} data-testid="add-missing">
            <ShoppingCart size={18} /> {check.toBuy.length ? `Ajouter ${check.toBuy.length} manquant${check.toBuy.length > 1 ? 's' : ''} à la liste` : check.status === 'ready' ? 'Rien à acheter' : 'Manquants déjà dans la liste'}
          </button>
        )}
        {canStock && <button className="btn primary" onClick={() => void cook()} data-testid="cook"><ChefHat size={18} /> Cuisiner</button>}
      </div>
      {check.toBuy.length > 0 && (
        <div className="xsmall subtle" style={{ marginTop: 6 }}>
          À acheter : {check.toBuy.map((n) => `${n.name} (${formatQty(n.quantity, n.unit)})`).join(', ')}.
        </div>
      )}

      {recipe.instructions && <>
        <div className="section-title">Préparation</div>
        <div className="card" style={{ whiteSpace: 'pre-wrap' }}>{recipe.instructions}</div>
      </>}
      {confirm.node}
    </>
  );
}

interface Draft {
  key: string;
  productId: string | null;
  name: string;
  qty: string;
  unit: UnitCode;
  optional: boolean;
}

function toDraft(i: RecipeIngredient): Draft {
  return { key: newId(), productId: i.productId, name: i.name, qty: String(i.quantity).replace('.', ','), unit: i.unit, optional: i.optional };
}

function IngredientEditor({ d, products, onChange, onRemove, index }: { d: Draft; products: Product[]; onChange: (d: Draft) => void; onRemove: () => void; index: number }) {
  const linked = d.productId ? products.find((p) => p.id === d.productId) ?? null : null;
  const q = normalizeName(d.name);
  const suggestions = !linked && q.length >= 2
    ? products.filter((p) => !p.archived && (normalizeName(p.name).includes(q) || p.aliases.some((a) => normalizeName(a.text).includes(q)))).slice(0, 4)
    : [];
  const units = linked ? compatibleUnits(linked) : null;
  return (
    <div className="card stack" style={{ ['--gap' as string]: '8px' }} data-testid="ingredient-editor">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TextField label={`Ingrédient ${index + 1}`} value={d.name} onChange={(e) => onChange({ ...d, name: e.target.value, productId: null })} maxLength={120} placeholder="Ex. Farine" />
        </div>
        <button className="btn ghost icon" onClick={onRemove} aria-label={`Retirer l’ingrédient ${index + 1}`}><Trash2 size={18} /></button>
      </div>
      {linked ? (
        <div className="row small">
          <span className="badge success">Lié au produit « {linked.name} »</span>
          <button className="btn ghost sm" onClick={() => onChange({ ...d, productId: null })} aria-label="Délier le produit"><X size={14} /> Délier</button>
        </div>
      ) : suggestions.length > 0 ? (
        <div className="row wrap small">
          <span className="subtle">Produit de l’inventaire :</span>
          {suggestions.map((p) => (
            <button key={p.id} className="btn soft sm" onClick={() => onChange({ ...d, productId: p.id, name: p.name, unit: compatibleUnits(p).includes(d.unit) ? d.unit : p.unit })}>{p.name}</button>
          ))}
        </div>
      ) : d.name.trim() ? (
        <div className="xsmall subtle">Non lié : HOMEOS le cherchera par son nom dans l’inventaire, sinon il sera « à vérifier ».</div>
      ) : null}
      <div className="row">
        <div style={{ flex: 1 }}>
          <TextField label="Quantité" inputMode="decimal" value={d.qty} onChange={(e) => onChange({ ...d, qty: e.target.value })} />
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Unité">
            {units ? (
              <select className="select" value={d.unit} onChange={(e) => onChange({ ...d, unit: e.target.value as UnitCode })}>
                {units.map((u) => <option key={u} value={u}>{formatQty(2, u).replace(/^2\s/, '')}</option>)}
              </select>
            ) : (
              <UnitSelect value={d.unit} onChange={(u) => u && onChange({ ...d, unit: u })} />
            )}
          </Field>
        </div>
      </div>
      <label className="row small" style={{ justifyContent: 'space-between' }}>
        <span>Facultatif</span>
        <Switch checked={d.optional} onChange={(v) => onChange({ ...d, optional: v })} label={`Ingrédient ${index + 1} facultatif`} />
      </label>
    </div>
  );
}

/** Création et modification d'une recette. */
export function RecipeEditPage() {
  const { id } = useParams();
  const view = useView();
  const run = useRun();
  const navigate = useNavigate();
  const products = useProducts();
  const existing = id ? (view.recipe.get(id) as Recipe | undefined) : undefined;
  const [loaded, setLoaded] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [servings, setServings] = useState('4');
  const [instructions, setInstructions] = useState('');
  const [lines, setLines] = useState<Draft[]>([]);
  const key = existing?.id ?? 'new';
  if (loaded !== key) {
    setLoaded(key);
    setName(existing?.name ?? '');
    setServings(String(existing?.servings ?? 4));
    setInstructions(existing?.instructions ?? '');
    setLines(existing ? existing.ingredients.map(toDraft) : [{ key: newId(), productId: null, name: '', qty: '', unit: 'piece', optional: false }]);
  }
  const parsed = lines
    .filter((l) => l.name.trim())
    .map((l) => ({ productId: l.productId, name: l.name.trim(), quantity: parseQty(l.qty), unit: l.unit, optional: l.optional }));
  const nServ = Number(servings);
  const invalid = !name.trim() || !Number.isInteger(nServ) || nServ < 1 || nServ > 100 || parsed.length === 0 || parsed.some((p) => p.quantity == null || p.quantity <= 0);
  const save = async () => {
    if (invalid) return;
    const rid = existing?.id ?? newId();
    const out = await run(
      'recipe.upsert',
      { id: rid, name: name.trim(), servings: nServ, ingredients: parsed.map((p) => ({ ...p, quantity: p.quantity! })), instructions: instructions.trim() || null, tags: existing?.tags ?? [] },
      { success: 'Recette enregistrée' },
    );
    if (out.ok) navigate(`/recettes/${rid}`, { replace: true });
  };
  return (
    <>
      <PageHead
        title={existing ? 'Modifier la recette' : 'Nouvelle recette'}
        eyebrow={<Link to={existing ? `/recettes/${existing.id}` : '/recettes'} className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> {existing ? existing.name : 'Recettes'}</Link>}
      />
      <div className="card stack">
        <TextField label="Nom de la recette" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="Ex. Crêpes" />
        <TextField label="Nombre de parts" inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="section-title">Ingrédients</div>
      <div className="stack">
        {lines.map((l, i) => (
          <IngredientEditor
            key={l.key}
            d={l}
            index={i}
            products={products}
            onChange={(d) => setLines(lines.map((x) => (x.key === l.key ? d : x)))}
            onRemove={() => setLines(lines.filter((x) => x.key !== l.key))}
          />
        ))}
      </div>
      <button className="btn" style={{ marginTop: 10 }} onClick={() => setLines([...lines, { key: newId(), productId: null, name: '', qty: '', unit: 'piece', optional: false }])} data-testid="add-ingredient">
        <Plus size={18} /> Ajouter un ingrédient
      </button>
      <div className="section-title">Préparation</div>
      <Field label="Étapes (facultatif)">
        <textarea className="textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={6} maxLength={20000} />
      </Field>
      <button className="btn primary lg block" style={{ marginTop: 14 }} onClick={() => void save()} disabled={invalid} data-testid="save-recipe">Enregistrer la recette</button>
    </>
  );
}
