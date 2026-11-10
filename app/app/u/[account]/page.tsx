import { notFound } from 'next/navigation';
import { ProfileView } from '@/components/features/profile/ProfileView';
import { isAccountParam } from '@/lib/account';

export const metadata = { title: 'Profile | Kruxa', description: 'Launches created, positions and creator totals for one account, from public on-chain events.' };

export default async function ProfilePage({ params }: { params: Promise<{ account: string }> }) {
  const account = decodeURIComponent((await params).account);
  if (!isAccountParam(account)) notFound();
  return <ProfileView account={account} />;
}
