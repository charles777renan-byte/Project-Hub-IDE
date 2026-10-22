/**
 * Guarda o fim da saída de um terminal, com um limite em bytes. Quando passa do limite, corta do início.
 * É o que o app mostra ao reconectar, então não precisa do histórico inteiro.
 */
export class RingBuffer {
  private readonly maxBytes: number;
  private chunks: Buffer[] = [];
  private bytes = 0;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  get size(): number {
    return this.bytes;
  }

  append(data: string | Buffer): void {
    const whole = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    if (whole.length === 0) return;
    // Um pedaço maior que o limite inteiro vale só pelo fim. Copiar evita segurar o pedaço original.
    const piece =
      whole.length > this.maxBytes
        ? Buffer.from(whole.subarray(whole.length - this.maxBytes))
        : whole;
    this.chunks.push(piece);
    this.bytes += piece.length;
    this.trim();
  }

  /** Conteúdo atual como texto. Um caractere partido no início, por causa do corte, não aparece. */
  read(): string {
    const all = Buffer.concat(this.chunks);
    let start = 0;
    // Bytes de continuação (10xxxxxx) no início são o fim de um caractere cortado ao meio.
    while (start < all.length && ((all[start] ?? 0) & 0xc0) === 0x80) start += 1;
    return all.subarray(start).toString('utf8');
  }

  clear(): void {
    this.chunks = [];
    this.bytes = 0;
  }

  private trim(): void {
    while (this.bytes > this.maxBytes) {
      const head = this.chunks[0];
      if (head === undefined) break;
      const excess = this.bytes - this.maxBytes;
      if (head.length <= excess) {
        this.chunks.shift();
        this.bytes -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.bytes -= excess;
      }
    }
  }
}
