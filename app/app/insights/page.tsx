import type { Metadata } from 'next';
import { StatsSection } from '@/components/features/insights/StatsSection';
import { ThesisSection } from '@/components/features/insights/ThesisSection';

export const metadata: Metadata = { title: 'Insights', description: 'Kruxa numbers from indexed events, and a recorded study of NEAR Intents activity.' };

export default function InsightsPage() {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Insights</p>
        <h1>Numbers, with their sources.</h1>
        <p className="lede">Section A is counted from indexed contract events and says so. Section B is a recorded study of the NEAR network, not live data.</p>
      </header>
      <StatsSection />
      <ThesisSection />
    </>
  );
}
