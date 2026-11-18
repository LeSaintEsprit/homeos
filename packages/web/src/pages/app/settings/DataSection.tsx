import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArchiveRestore, CheckCircle2, Database, Download, FileUp, HardDriveDownload, RefreshCw, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { del, errorMessage, get, post } from '../../../lib/api';
import { applyMe, setActiveHousehold, type Me } from '../../../lib/session';
import { toast } from '../../../lib/toast';
import { useHousehold } from '../../../lib/hooks';
import { useCan, useEngine } from '../../../lib/sync/react';
import { relativeTime, formatDate } from '../../../lib/format';
import { Sheet } from '../../../ui/Sheet';
import { Spinner } from '../../../ui/Controls';
import { TextField } from '../../../ui/Field';

interface Issue { code?: string; severity: string; message: string }
interface BackupInfo { name: string; reason: string; createdAt: string; sizeBytes?: number; verified?: boolean; verifyError?: string | null; counts?: Record<string, number> }

const REASONS: Record<string, string> = { auto: 'automatique', manual: 'manuelle', 'pre-import': 'avant un import', 'pre-restore': 'avant une restauration', 'pre-delete': 'avant une suppression' };
const size = (b?: number) => (b == null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(b / 1e3))} Ko`);

function Section({ icon, title, children, id }: { icon: ReactNode; title: string; children: ReactNode; id?: string }) {
  return (
    <section className="card" id={id} style={{ marginBottom: 16 }}>
      <div className="card-title"><h3 className="row" style={{ ['--gap' as string]: '10px' }}>{icon} {title}</h3></div>
      <div className="stack" style={{ ['--gap' as string]: '14px' }}>{children}</div>
    </section>
  );
}

/** Après un import, une restauration ou une suppression : session à jour et foyer actif adapté. */
function useSwitchTo() {
  const navigate = useNavigate();
  const engine = useEngine();
  return async (me: Me, householdId: string | null) => {
    await engine.drain().catch(() => undefined);
    applyMe(me);
    if (householdId) setActiveHousehold(householdId);
    navigate(me.households.length ? '/' : '/bienvenue');
  };
}

export function ImportReport({ report }: { report: { counts: Record<string, number>; issues: Issue[] } }) {
  return (
    <div className="small muted">
      {Object.entries(report.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(' · ')}
      {report.issues.length > 0 && <div className="alert warning" style={{ marginTop: 8 }}><AlertTriangle size={16} /> {report.issues.length} remarque(s) : {report.issues[0].message}</div>}
    </div>
  );
}

export function DataSection() {
  const { id: hid, name } = useHousehold();
  const canExport = useCan('data.export');
  const canRestore = useCan('data.import');
  const canDelete = useCan('household.delete');
  const switchTo = useSwitchTo();
  const fileRef = useRef<HTMLInputElement>(null);
  const [check, setCheck] = useState<{ ok: boolean; issues: Issue[]; checkedAt: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await get(`/api/households/${hid}/integrity`));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setChecking(false);
    }
  };
  const doImport = async (file: File) => {
    setImporting(true);
    try {
      const data = JSON.parse(await file.text());
      const r = await post<Me & { householdId: string; counts: Record<string, number>; issues: Issue[] }>('/api/households/import', data);
      const n = r.counts.product ?? 0;
      toast(`Foyer importé (${n} produit${n > 1 ? 's' : ''}) : il apparaît dans vos foyers sous le nom « … (import) ».`, 'success', { ms: 7000 });
      await switchTo(r, r.householdId);
    } catch (e) {
      toast(e instanceof SyntaxError ? 'Ce fichier n’est pas un export HOMEOS (JSON illisible).' : errorMessage(e), 'error', { ms: 8000 });
    } finally {
      setImporting(false);
    }
  };
  const openRestore = async () => {
    setRestoreOpen(true);
    setPicked(null);
    setBackups(null);
    try {
      setBackups((await get<{ backups: BackupInfo[] }>(`/api/households/${hid}/backups`)).backups);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBackups([]);
    }
  };
  const doRestore = async () => {
    if (!picked) return;
    setRestoring(true);
    try {
      const r = await post<Me & { householdId: string }>(`/api/households/${hid}/restore`, { backup: picked });
      toast('Foyer restauré dans un nouveau foyer : le foyer actuel n’a pas été modifié.', 'success', { ms: 7000 });
      setRestoreOpen(false);
      await switchTo(r, r.householdId);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setRestoring(false);
    }
  };
  const doDelete = async () => {
    setDeleting(true);
    try {
      const r = await del<Me>(`/api/households/${hid}`, { confirmName });
      toast(`« ${name} » a été supprimé. Une sauvegarde a été faite juste avant.`, 'success', { ms: 7000 });
      setDelOpen(false);
      await switchTo(r, null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Section icon={<Database size={20} />} title={`Données du foyer « ${name} »`} id="donnees">
      <div className="data-block">
        <div>
          <div className="strong">Contrôle d'intégrité</div>
          <div className="small muted">Vérifie les quantités, les mouvements, les dates et les références de ce foyer sur le serveur.</div>
        </div>
        <button className="btn" onClick={() => void runCheck()} disabled={checking} data-testid="integrity-check">{checking ? <Spinner /> : <ShieldCheck size={17} />} Vérifier maintenant</button>
        {check && (
          <div className={`alert ${check.ok && !check.issues.length ? 'success' : check.ok ? 'info' : 'error'}`} data-testid="integrity-result">
            {check.ok && !check.issues.length ? <CheckCircle2 size={18} /> : check.ok ? <AlertTriangle size={18} /> : <XCircle size={18} />}
            <span>
              {check.ok && !check.issues.length ? 'Aucune anomalie : les données sont cohérentes.' : `${check.issues.length} point(s) à examiner${check.ok ? ' (aucune erreur)' : ''}.`}
              {check.issues.length > 0 && <> <Link to="/inventaire/controle">Voir le contrôle de cohérence</Link></>}
              <span className="xsmall" style={{ display: 'block', opacity: 0.8 }}>Vérifié {relativeTime(check.checkedAt)}</span>
            </span>
          </div>
        )}
      </div>

      {canExport && (
        <div className="data-block">
          <div>
            <div className="strong">Exporter</div>
            <div className="small muted">Copie complète et lisible de ce foyer, à conserver où vous voulez. Un export n'est pas une sauvegarde automatique : celles-ci sont faites chaque jour par le serveur.</div>
          </div>
          <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
            <a className="btn" href={`/api/households/${hid}/export`} download data-testid="export-json"><Download size={17} /> Export complet (JSON, avec photos)</a>
            <a className="btn ghost" href={`/api/households/${hid}/export?photos=0`} download>Sans les photos</a>
          </div>
          <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
            <span className="small muted">Tableurs (CSV) :</span>
            <a className="btn sm" href={`/api/households/${hid}/export/inventaire.csv`} download data-testid="export-csv">Inventaire</a>
            <a className="btn sm" href={`/api/households/${hid}/export/achats.csv`} download>Achats</a>
            <a className="btn sm" href={`/api/households/${hid}/export/mouvements.csv`} download>Mouvements</a>
          </div>
        </div>
      )}

      <div className="data-block">
        <div>
          <div className="strong">Importer un export</div>
          <div className="small muted">Crée un <strong>nouveau foyer</strong> à partir d'un export HOMEOS (de cette instance ou d'une autre). Aucun foyer existant n'est modifié ; vous en êtes l'administrateur.</div>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doImport(f); }} />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={importing}>{importing ? <Spinner /> : <FileUp size={17} />} Importer un fichier</button>
      </div>

      {canRestore && (
        <div className="data-block">
          <div>
            <div className="strong">Revenir à une version précédente</div>
            <div className="small muted">Récupère ce foyer tel qu'il était dans une sauvegarde du serveur. La version restaurée devient un nouveau foyer : vous pouvez comparer, puis supprimer celui dont vous ne voulez plus.</div>
          </div>
          <button className="btn" onClick={() => void openRestore()} data-testid="open-restore"><ArchiveRestore size={17} /> Choisir une sauvegarde</button>
        </div>
      )}

      {canDelete && (
        <div className="data-block danger-zone">
          <div>
            <div className="strong">Supprimer ce foyer</div>
            <div className="small muted">Supprime définitivement le foyer pour tous ses membres. Une sauvegarde est faite juste avant : en cas d'erreur, l'hébergeur de l'instance peut récupérer ce foyer seul, sans toucher aux autres.</div>
          </div>
          <button className="btn danger-soft" onClick={() => { setConfirmName(''); setDelOpen(true); }} data-testid="open-delete-household"><Trash2 size={17} /> Supprimer le foyer</button>
        </div>
      )}

      <Sheet open={restoreOpen} onClose={() => setRestoreOpen(false)} title="Restaurer une version de ce foyer" footer={<button className="btn primary" onClick={() => void doRestore()} disabled={!picked || restoring} data-testid="do-restore">{restoring ? <Spinner /> : <ArchiveRestore size={17} />} Restaurer comme nouveau foyer</button>}>
        {backups == null ? (
          <div className="row"><Spinner /> <span className="muted">Recherche des sauvegardes…</span></div>
        ) : backups.length === 0 ? (
          <p className="muted">Aucune sauvegarde du serveur ne contient encore ce foyer. Le serveur en fait une chaque jour.</p>
        ) : (
          <div className="card pad-0 flat" data-testid="household-backups">
            {backups.map((b) => (
              <button key={b.name} className="list-row" onClick={() => setPicked(b.name)} aria-pressed={picked === b.name}>
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{formatDate(b.createdAt)} · {new Date(b.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="sub">Sauvegarde {REASONS[b.reason] ?? b.reason}</span>
                </span>
                {picked === b.name && <CheckCircle2 size={20} color="var(--primary)" />}
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={delOpen} onClose={() => setDelOpen(false)} title="Supprimer définitivement ce foyer ?">
        <div className="alert error"><AlertTriangle size={18} /> Stocks, listes, historique, dépenses et photos de « {name} » seront supprimés pour tous les membres.</div>
        <TextField label={`Tapez le nom du foyer (« ${name} ») pour confirmer`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" data-testid="confirm-name" />
        <button className="btn danger" disabled={confirmName.trim() !== name || deleting} onClick={() => void doDelete()} data-testid="do-delete-household">{deleting ? <Spinner /> : <Trash2 size={17} />} Supprimer définitivement</button>
      </Sheet>
    </Section>
  );
}

/** Sauvegardes de l'instance (hébergeur uniquement). */
export function ServerBackups() {
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<BackupInfo | null>(null);
  const [confirm, setConfirm] = useState('');
  const [inspect, setInspect] = useState<BackupInfo | null>(null);
  const [homes, setHomes] = useState<{ id: string; name: string; members: number; products: number; existsNow: boolean }[] | null>(null);
  const openHomes = async (b: BackupInfo) => {
    setInspect(b);
    setHomes(null);
    try {
      setHomes((await get<{ households: NonNullable<typeof homes> }>(`/api/admin/backups/${encodeURIComponent(b.name)}/households`)).households);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setHomes([]);
    }
  };
  const recover = async (h: { id: string; name: string }) => {
    if (!inspect) return;
    setBusy(true);
    try {
      const r = await post<{ name: string; issues: Issue[] }>(`/api/admin/backups/${encodeURIComponent(inspect.name)}/households/${h.id}/restore`);
      toast(`« ${r.name} » récupéré : ses membres y ont de nouveau accès.${r.issues[0] ? ` ${r.issues[0].message}` : ''}`, 'success', { ms: 9000 });
      setInspect(null);
      await load();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const load = () => get<{ backups: BackupInfo[] }>('/api/admin/backups').then((r) => setList(r.backups)).catch((e) => { toast(errorMessage(e), 'error'); setList([]); });
  useEffect(() => void load(), []);
  const create = async () => {
    setBusy(true);
    try {
      const r = await post<{ backup: BackupInfo }>('/api/admin/backups');
      toast(r.backup.verified ? 'Sauvegarde créée et vérifiée' : `Sauvegarde créée mais non vérifiée : ${r.backup.verifyError}`, r.backup.verified ? 'success' : 'warning');
      await load();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const doRestore = async () => {
    if (!restore) return;
    setBusy(true);
    try {
      const r = await post<{ safetyBackup: string }>(`/api/admin/backups/${encodeURIComponent(restore.name)}/restore`, { confirm });
      toast(`Instance restaurée. Une sauvegarde de sécurité de l'état précédent a été faite (${r.safetyBackup}). Les appareils se resynchronisent.`, 'success', { ms: 9000 });
      setRestore(null);
      await load();
    } catch (e) {
      toast(errorMessage(e), 'error', { ms: 8000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" data-testid="server-backups">
      <div className="row spread">
        <div>
          <div className="strong">Sauvegardes de l'instance</div>
          <div className="small muted">Automatiques chaque nuit (14 quotidiennes et 12 mensuelles conservées), vérifiées à leur création. Copiez-les aussi hors de cette machine.</div>
        </div>
      </div>
      <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
        <button className="btn" onClick={() => void create()} disabled={busy} data-testid="create-backup">{busy ? <Spinner /> : <HardDriveDownload size={17} />} Sauvegarder maintenant</button>
        <button className="btn ghost" onClick={() => void load()}><RefreshCw size={16} /> Actualiser</button>
      </div>
      {list == null ? <Spinner /> : list.length === 0 ? <p className="small muted">Aucune sauvegarde pour l'instant.</p> : (
        <div className="card pad-0 flat">
          {list.slice(0, 40).map((b) => (
            <div key={b.name} className="list-row" data-testid="backup-row">
              {b.verified ? <CheckCircle2 size={18} color="var(--success)" aria-label="Vérifiée" /> : <XCircle size={18} color="var(--danger)" aria-label="Non vérifiée" />}
              <span className="meta">
                <span className="title" style={{ display: 'block' }}>{formatDate(b.createdAt)} · {new Date(b.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="sub">{REASONS[b.reason] ?? b.reason} · {size(b.sizeBytes)}{b.counts ? ` · ${b.counts.households ?? 0} foyer(s), ${b.counts.products ?? 0} produits` : ''}{!b.verified && b.verifyError ? ` · ${b.verifyError}` : ''}</span>
              </span>
              <a className="btn ghost icon sm" href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download aria-label={`Télécharger la sauvegarde du ${formatDate(b.createdAt)}`}><Download size={16} /></a>
              <button className="btn ghost sm" onClick={() => void openHomes(b)} disabled={!b.verified} data-testid="backup-households">Foyers…</button>
              <button className="btn ghost sm" onClick={() => { setConfirm(''); setRestore(b); }} disabled={!b.verified}>Tout restaurer</button>
            </div>
          ))}
        </div>
      )}
      <Sheet open={!!inspect} onClose={() => setInspect(null)} title="Récupérer un seul foyer">
        <p className="small muted">Le foyer choisi est recréé tel qu'il était dans cette sauvegarde, comme nouveau foyer. Les autres familles ne sont pas touchées ; ses membres dont le compte existe toujours y retrouvent leur rôle. Vous n'en devenez pas membre, sauf s'il n'y restait aucun administrateur.</p>
        {homes == null ? <Spinner /> : (
          <div className="card pad-0 flat" data-testid="backup-homes">
            {homes.map((h) => (
              <div key={h.id} className="list-row">
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{h.name}</span>
                  <span className="sub">{h.members} membre(s) · {h.products} produit(s) · {h.existsNow ? 'existe toujours' : 'supprimé depuis'}</span>
                </span>
                <button className="btn sm" onClick={() => void recover(h)} disabled={busy}>Récupérer</button>
              </div>
            ))}
          </div>
        )}
      </Sheet>
      <Sheet open={!!restore} onClose={() => setRestore(null)} title="Restaurer toute l'instance ?">
        <div className="alert error"><AlertTriangle size={18} /> Toutes les familles hébergées reviendront à l'état du {restore ? `${formatDate(restore.createdAt)} à ${new Date(restore.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}. Les modifications faites depuis seront perdues (une sauvegarde de sécurité de l'état actuel est faite avant).</div>
        <p className="small muted">Pour ne récupérer qu'un seul foyer, utilisez plutôt « Foyers… » : les autres familles ne sont pas touchées.</p>
        <TextField label="Tapez RESTAURER pour confirmer" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" data-testid="confirm-restore" />
        <button className="btn danger" disabled={confirm !== 'RESTAURER' || busy} onClick={() => void doRestore()} data-testid="do-restore-instance">{busy ? <Spinner /> : <ArchiveRestore size={17} />} Restaurer l'instance</button>
      </Sheet>
    </div>
  );
}
