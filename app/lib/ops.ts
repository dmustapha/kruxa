// Operator powers, stated once. The /ops-log page and the legal copy quote this table; app/lib/ops.test.ts ties each delay to the contract source
// (contracts/core/src/govern.rs) so a code change fails the docs build instead of leaving a stale promise on the page.
export interface OperatorPower {
  id: string;
  who: string;
  power: string;
  limit: string;
  /** Delay in days before the power takes effect, when it has one. */
  delayDays?: number;
}

export const OPERATOR_POWERS: OperatorPower[] = [
  { id: 'pause', who: 'Owner or guardian', power: 'Pause the core contract.', limit: 'A pause does not block exits. Walk, refunds and token claims keep working.' },
  { id: 'freeze', who: 'Owner or guardian', power: 'Freeze the core contract.', limit: 'A freeze can block exits. It ends by itself after 7 days and falls back to a pause.', delayDays: 7 },
  { id: 'halt_launch', who: 'Owner or guardian', power: 'Halt one launch: stops new commits and the creator side payouts of that launch.', limit: 'Cannot block exits, Walk, refunds or token claims, and cannot change a verdict. A halt can only turn a launch toward FAIL. Only the owner can resume it.' },
  { id: 'queue_upgrade', who: 'Owner', power: 'Queue a new core code hash in public.', limit: 'The code can be replaced only 7 days after the hash was queued. The guardian can cancel a queued upgrade.', delayDays: 7 },
  { id: 'force_resolve_op', who: 'Owner', power: 'Resolve one stuck outbound payout leg, in two steps with the same arguments.', limit: 'Waits 48 hours between the two steps. Can move at most what is in flight, to no new destination, and never touches a verdict.', delayDays: 2 },
  { id: 'cap_raise', who: 'Owner', power: 'Queue a raise of the per-launch or global cap.', limit: 'Waits 7 days. Lowering a cap is immediate.', delayDays: 7 },
  { id: 'burn_mode', who: 'Owner', power: 'Choose what sweeping unclaimed tokens does: hold, or send to a sink account.', limit: 'The default is Hold. The mode locks after the first call or the first sweep. A sink cannot be a Kruxa controlled account. Burn is refused.' },
  { id: 'check_solvency', who: 'Anyone', power: 'Run a solvency check on the core contract.', limit: 'Informational. It moves no money. If the Intents balance is below what core owes there, it raises an alert that pauses new Intents commits only.' },
];

/** NEAR block timestamps are nanoseconds in a decimal string. Returns unix seconds, or null when the value is not one. */
export function nsToUnix(ns: string | number | null | undefined): number | null {
  if (ns === null || ns === undefined || !/^[0-9]+$/.test(String(ns))) return null;
  return Number(BigInt(String(ns)) / 1_000_000_000n);
}

/** Plain name for an event in the log. Unknown events keep their raw name rather than being guessed at. */
const EVENT_LABEL: Record<string, string> = {
  paused: 'Paused', unpaused: 'Unpaused', frozen: 'Frozen', halted: 'Launch halted', resumed: 'Launch resumed',
  upgrade_queued: 'Upgrade queued', upgrade_cancelled: 'Upgrade cancelled', upgraded: 'Upgraded',
  force_resolve_queued: 'Force-resolve queued', op_force_resolved: 'Force-resolved',
  global_cap_queued: 'Global cap raise queued', global_cap_applied: 'Global cap applied', global_cap_lowered: 'Global cap lowered',
  launch_cap_queued: 'Launch cap raise queued', launch_cap_applied: 'Launch cap applied', cap_queued: 'Cap raise queued', cap_applied: 'Cap applied', cap_lowered: 'Cap lowered',
  market_paused: 'Market paused', platform_withdrawn: 'Platform fees withdrawn', beta_opened: 'Creator gate opened', market_set: 'Market set',
  genesis_relayer_set: 'Genesis relayer set', genesis_paused: 'Genesis paused', genesis_resumed: 'Genesis resumed', symbol_reserved: 'Symbol reserved', solvency_report: 'Solvency report',
};
export const eventLabel = (e: string): string => EVENT_LABEL[e] ?? e.replace(/_/g, ' ');

/** Category used by the filter. */
export type OpsGroup = 'pauses' | 'upgrades' | 'halts' | 'resolves' | 'caps' | 'other';
export function groupOf(event: string): OpsGroup {
  if (/pause|unpause|frozen|resumed$/.test(event) && !event.startsWith('genesis')) return 'pauses';
  if (event.startsWith('upgrade')) return 'upgrades';
  if (event === 'halted') return 'halts';
  if (event.includes('force_resolve') || event === 'op_force_resolved') return 'resolves';
  if (event.includes('cap')) return 'caps';
  return 'other';
}
export const GROUP_LABEL: Record<OpsGroup, string> = { pauses: 'Pauses and freezes', upgrades: 'Upgrades', halts: 'Halts', resolves: 'Force-resolves', caps: 'Caps', other: 'Other' };
