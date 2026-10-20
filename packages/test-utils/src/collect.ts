/** Junta, em ordem, todos os itens de um fluxo assíncrono. Espera o fluxo terminar. */
export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}
