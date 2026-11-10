'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** A failed trial has no market, so the token page sends you to the trial page, where the refund is. The failed card stays on screen as the fallback while it happens (APP-SPEC 5.5). */
export function FailedRedirect({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(`/launch/${encodeURIComponent(id)}`); }, [id, router]);
  return <p className="mkt-note" role="status">Taking you to the trial page, where refunds are claimed.</p>;
}
