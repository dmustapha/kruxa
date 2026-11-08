'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CreateStudio } from './CreateStudio';
import { InstantStudio } from '../instant/InstantStudio';
import { ModeSelector, type LaunchModeChoice } from '../instant/ModeSelector';
import { CONFIG } from '@/lib/config';

/** The Create page: a launch-type selector, then the form for the chosen type. Trial launch is the default; instant is `?mode=instant`. */
export function CreateRoot() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const instantOff = !CONFIG.instantEnabled;
  const mode: LaunchModeChoice = params.get('mode') === 'instant' && !instantOff ? 'instant' : 'trial';
  const choose = (m: LaunchModeChoice) => {
    const next = new URLSearchParams(params.toString());
    if (m === 'instant') next.set('mode', 'instant'); else next.delete('mode');
    next.delete('preset');
    router.replace(`${path}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  return (
    <>
      <ModeSelector mode={mode} onChange={choose} instantDisabledReason={instantOff ? 'Instant launch: not available yet.' : null} />
      {mode === 'instant' ? <InstantStudio /> : <CreateStudio />}
    </>
  );
}
