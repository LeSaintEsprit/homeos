import type { ReactNode } from 'react';
import { Construction } from 'lucide-react';
import { EmptyState } from '../../ui/Controls';
import { PageHead } from './Shell';

/** Écran provisoire pendant le développement d'un module (voir PROJECT_PLAN.md). */
export function Placeholder({ title, phase, children }: { title: string; phase: number; children?: ReactNode }) {
  return (
    <>
      <PageHead title={title} />
      <EmptyState icon={<Construction size={28} />} title="Module en cours de construction">
        {children ?? `Ce module arrive à la phase ${phase} du plan de développement.`}
      </EmptyState>
    </>
  );
}
