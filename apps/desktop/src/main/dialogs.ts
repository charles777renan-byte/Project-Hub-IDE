import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron';

/**
 * Seletor nativo de pasta, aberto sobre a janela de quem chamou. Devolve o caminho escolhido, ou
 * null quando a pessoa cancela. O caminho volta ao renderer só como `{ path }`, e o cadastro o
 * revalida antes de criar o projeto (R66).
 */
export async function chooseProjectDirectory(sender: WebContents): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Escolher a pasta do projeto',
    properties: ['openDirectory'],
  };
  const owner = BrowserWindow.fromWebContents(sender);
  const result =
    owner === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(owner, options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
