import type { Metadata } from 'next';
import { PortfolioView } from '@/components/features/portfolio/PortfolioView';

export const metadata: Metadata = { title: 'Portfolio' };
export default function PortfolioPage() { return <PortfolioView />; }
