/**
 * Shared NDJSON line splitter for the stream sinks (live feed, turn watcher).
 * `feed` scans only the new chunk for `\n`; a partial line is held as an
 * array of parts with a running length and joined once, when its newline
 * arrives. A held partial line longer than the cap is discarded and the
 * splitter skips to the next newline (the run log keeps the bytes).
 */

/** A held partial line longer than this is dropped unparsed. */
export const PENDING_MAX_CHARS = 4 * 1024 * 1024;

export class LineSplitter {
  private parts: string[] = [];
  private length = 0;
  private dropping = false;

  constructor(private readonly maxChars: number = PENDING_MAX_CHARS) {}

  /** Calls `onLine` for every line the chunk completes (without the `\n`). */
  feed(text: string, onLine: (line: string) => void): void {
    let start = 0;
    let nl = text.indexOf("\n", start);
    while (nl !== -1) {
      const segment = text.slice(start, nl);
      if (this.dropping) {
        this.dropping = false;
      } else if (this.parts.length === 0) {
        onLine(segment);
      } else {
        this.parts.push(segment);
        const line = this.parts.join("");
        this.parts = [];
        this.length = 0;
        onLine(line);
      }
      start = nl + 1;
      nl = text.indexOf("\n", start);
    }
    if (start >= text.length || this.dropping) return;
    const tail = start === 0 ? text : text.slice(start);
    this.parts.push(tail);
    this.length += tail.length;
    if (this.length > this.maxChars) {
      this.parts = [];
      this.length = 0;
      this.dropping = true;
    }
  }

  /** The held partial line ("" when none or when it was dropped); resets. */
  end(): string {
    const rest = this.dropping ? "" : this.parts.join("");
    this.parts = [];
    this.length = 0;
    this.dropping = false;
    return rest;
  }
}
