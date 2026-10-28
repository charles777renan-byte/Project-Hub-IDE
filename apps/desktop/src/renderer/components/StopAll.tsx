import { useState } from 'react';
import { notify } from '../notify';
import { scheduleReload } from '../overview-data';
import { useOverview } from '../use-overview';
import { ConfirmButton } from './ConfirmButton';

const plural = (count: number) => (count === 1 ? '1 missão' : `${count} missões`);

/**
 * "Parar todos", na barra de status: cancela as missões em execução (as mesmas que o contador "N executando" conta), depois
 * de uma pergunta na mesma linha. Só aparece quando há alguma. Usa o cancelamento que a missão já tem, então a
 * pessoa pode tentar de novo depois. Terminais abertos não são tocados: fechá-los mataria sessões vivas.
 */
export function StopAll() {
  const { items } = useOverview();
  const [stopping, setStopping] = useState(false);
  const running = items.filter((item) => item.mission.status === 'running');
  if (running.length === 0) return null;

  async function stopAll() {
    setStopping(true);
    let failed = 0;
    for (const item of running) {
      try {
        const result = await window.projectHub.missions.cancel(item.mission.id);
        if (!result.ok) failed += 1;
      } catch {
        failed += 1;
      }
    }
    scheduleReload();
    setStopping(false);
    if (failed === 0)
      notify.success(`${plural(running.length)} cancelada${running.length === 1 ? '' : 's'}.`);
    else notify.error(`Não foi possível cancelar ${plural(failed)}. Tente de novo.`);
  }

  return (
    <ConfirmButton
      label="Parar todos"
      question={`Cancelar ${plural(running.length)} em execução?`}
      confirmLabel="Cancelar"
      disabled={stopping}
      hint="Cancela as missões em execução. Os terminais abertos não são tocados."
      onConfirm={() => void stopAll()}
    />
  );
}
