import { useRef, useState } from 'react';
import { Camera, Check, ScanText } from 'lucide-react';
import { findExpiryDates, type DateCandidate } from '@homeos/shared';
import { recognizeText, type OcrProgress } from '../../../lib/ocr';
import { useToday } from '../../../lib/hooks';
import { formatDate } from '../../../lib/format';

const KIND_LABEL = { dlc: 'À consommer jusqu’au (DLC)', ddm: 'De préférence avant (DDM)' } as const;

/**
 * Photo de l'étiquette → dates reconnues proposées → l'utilisateur choisit.
 * Rien n'est enregistré sans ce choix explicite ; la source devient « reconnue et confirmée ».
 */
export function DateFromPhoto({ onPick, compact = false }: { onPick: (date: string, kind: 'dlc' | 'ddm' | null) => void; compact?: boolean }) {
  const today = useToday();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [candidates, setCandidates] = useState<DateCandidate[]>([]);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const run = async (file: File) => {
    setState('busy');
    setCandidates([]);
    setPicked(null);
    try {
      const t = await recognizeText(file, 'label', setProgress);
      setText(t);
      setCandidates(findExpiryDates(t, today).slice(0, 4));
      setState('done');
    } catch {
      setState('error');
    }
  };
  return (
    <div className="ocr-date" data-testid="ocr-date">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden data-testid="ocr-date-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(f); }} />
      <button type="button" className={`btn ${compact ? 'sm' : ''} soft`} onClick={() => fileRef.current?.click()} disabled={state === 'busy'}>
        <Camera size={16} /> {state === 'idle' ? 'Lire la date sur une photo' : 'Reprendre une photo'}
      </button>
      {state === 'busy' && (
        <div className="small muted" role="status">
          <ScanText size={14} style={{ verticalAlign: '-2px' }} /> {progress?.stage === 'recognizing' ? `Lecture de l'étiquette… ${Math.round((progress.progress ?? 0) * 100)} %` : 'Préparation de la lecture (première fois : quelques secondes)…'}
        </div>
      )}
      {state === 'error' && <div className="alert warning">La lecture a échoué. Saisissez la date à la main.</div>}
      {state === 'done' && candidates.length === 0 && (
        <div className="alert info" data-testid="ocr-none">Aucune date lisible sur cette photo. Rapprochez-vous de la date, bien éclairée, ou saisissez-la.</div>
      )}
      {state === 'done' && candidates.length > 0 && (
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <div className="small muted">Date{candidates.length > 1 ? 's' : ''} reconnue{candidates.length > 1 ? 's' : ''} — touchez la bonne :</div>
          {candidates.map((c) => (
            <button
              key={`${c.date}-${c.kind}`}
              type="button"
              className="option-card ocr-candidate"
              aria-pressed={picked === c.date}
              onClick={() => { setPicked(c.date); onPick(c.date, c.kind); }}
              data-testid="ocr-candidate"
            >
              <span className="oc-icon" style={{ width: 34, height: 34 }}>{picked === c.date ? <Check size={17} /> : <ScanText size={17} />}</span>
              <span>
                <span className="strong">{formatDate(c.date)}</span>
                <br />
                <span className="xsmall muted">{c.kind ? KIND_LABEL[c.kind] : 'Type de date non précisé'} · lu « {c.raw} »</span>
              </span>
            </button>
          ))}
          <details className="xsmall subtle"><summary>Texte lu</summary><pre className="ocr-text">{text}</pre></details>
        </div>
      )}
    </div>
  );
}
