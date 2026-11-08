/** The README headline is Dami's to decide (DECISIONS-PACK1 #17). This is a clearly marked placeholder, not marketing copy.
 *  Replace the h1 text when a headline is chosen; it must carry the creator-maximum qualifier (INVARIANTS MUST NOT CLAIM). */
export function HeadlinePlaceholder({ id }: { id?: string }) {
  return (
    <div className="placeholder" role="note">
      <span className="tag">Placeholder headline, wording is Dami&apos;s decision</span>
      <h1 id={id} style={{ fontSize: 'clamp(1.5rem, 5vw, 2.25rem)', marginTop: 6 }}>[The hardest guarantee goes here, with one proof command under it]</h1>
    </div>
  );
}
