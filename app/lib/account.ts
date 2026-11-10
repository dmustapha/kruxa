/** NEAR account ids and `sol:<base58>` keys, as used in /u/[account]. Anything else is a 404 before any request is made. */
export const isAccountParam = (v: string): boolean => /^(sol:[1-9A-HJ-NP-Za-km-z]{32,44}|[a-z0-9][a-z0-9._-]{1,63})$/.test(v);
