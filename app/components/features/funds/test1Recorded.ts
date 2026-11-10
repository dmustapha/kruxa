/** Test 1 legs, copied by hand from evidence/test1-ov4.json and evidence/test1-ov15.json (mainnet, 2026-11-08). RECORDED, never live. */
export interface RecordedLeg {
  id: string;
  what: string;
  sent: string;
  arrived: string;
  seconds: string;
  tx?: string;
}

export const TEST1_LEGS: RecordedLeg[] = [
  { id: 'OV4', what: 'SOL to USDC (NEAR), 1Click quote', sent: '0.002 SOL', arrived: '0.17742 USDC in Intents', seconds: 'about 90 s' },
  { id: 'OV4', what: 'SOL to Solana-USDC credit', sent: '0.001485 SOL', arrived: '0.131942 USDC in Intents', seconds: '97 s' },
  {
    id: 'OV15',
    what: 'intents.near ft_withdraw to a fresh Solana address',
    sent: '0.060000 USDC',
    arrived: '0.030000 USDC (fixed 0.03 bridge fee)',
    seconds: 'n/a',
    tx: '3KLVemdjr387BsqJiuuV9By9VXzeri6GRFwy3HMRT6ko',
  },
];
