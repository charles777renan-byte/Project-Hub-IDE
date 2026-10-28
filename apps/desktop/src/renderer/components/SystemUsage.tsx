import { useSystemUsage } from '../use-system-usage';

const GIB = 1024 ** 3;

/** Bytes em GB com vírgula: "6,4". O total sai sem casa decimal quando é inteiro ("24"). */
function gigabytes(bytes: number, fixed: boolean): string {
  return (bytes / GIB).toLocaleString('pt-BR', {
    minimumFractionDigits: fixed ? 1 : 0,
    maximumFractionDigits: 1,
  });
}

/**
 * Uso do computador na barra de status: "CPU 12%" e "RAM 6,4/24 GB". Antes da primeira leitura, ou se ela falhar,
 * os valores aparecem como traço. Não é uma região viva: o número muda a cada poucos segundos, e anunciar cada
 * mudança só atrapalharia a leitura de tela.
 */
export function SystemUsage() {
  const usage = useSystemUsage();
  const cpu = usage?.cpuPercent == null ? '—' : `${usage.cpuPercent}%`;
  const ram =
    usage === null
      ? '—'
      : `${gigabytes(usage.memoryUsedBytes, true)}/${gigabytes(usage.memoryTotalBytes, false)} GB`;
  return (
    <div className="system-usage" role="group" aria-label="Uso do computador">
      <span>CPU {cpu}</span>
      <span>RAM {ram}</span>
    </div>
  );
}
