import type { Metadata } from 'next';
import { SettingsView } from '@/components/features/settings/SettingsView';

export const metadata: Metadata = { title: 'Settings', description: 'Local preferences for this browser: slippage, presets, endpoints and display.' };
export default function SettingsPage() { return <SettingsView />; }
