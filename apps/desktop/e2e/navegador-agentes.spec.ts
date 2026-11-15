import { expect, test } from './fixtures';
import { SUPPORT_WINDOW_OPTIONS } from '../src/main/browser/agent/agent-window-options';

// Os agentes dos terminais usando o navegador do projeto (fase 3). Tudo com dados descartáveis e páginas locais.

test.describe('janela de apoio das páginas de agente', () => {
  test('desenha a página fora da tela, sem tomar o foco, com a janela principal à vista e minimizada', async ({
    launchApp,
  }) => {
    const { app } = await launchApp();
    const result = await app.evaluate(
      async ({ BrowserWindow, WebContentsView, nativeImage }, options) => {
        const main = BrowserWindow.getAllWindows()[0];
        if (main === undefined) throw new Error('sem janela principal');
        main.focus();
        const support = new BrowserWindow({ ...options });
        support.showInactive();
        // Sessão própria, como a das páginas de agente: as regras da janela do app não valem para ela.
        const view = new WebContentsView({
          webPreferences: { partition: 'navegador-agente-teste', sandbox: true },
        });
        support.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: options.width, height: options.height });
        const contents = view.webContents;
        await contents.loadURL(
          'data:text/html,' + encodeURIComponent('<body style="margin:0;background:#c00"></body>'),
        );
        contents.debugger.attach('1.3');
        const shot = async (): Promise<string> => {
          const reply = (await contents.debugger.sendCommand('Page.captureScreenshot', {
            format: 'png',
          })) as { data: string };
          const image = nativeImage.createFromBuffer(Buffer.from(reply.data, 'base64'));
          const size = image.getSize();
          return `${size.width}x${size.height} ${[...image.toBitmap().subarray(0, 4)].join(',')}`;
        };
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        await wait(300);
        const shown = await shot();
        const focusedIsSupport = BrowserWindow.getFocusedWindow() === support;
        const bounds = support.getBounds();
        main.minimize();
        await wait(500);
        const minimized = await shot();
        main.restore();
        support.destroy();
        return { shown, minimized, focusedIsSupport, x: bounds.x, y: bounds.y };
      },
      SUPPORT_WINDOW_OPTIONS,
    );

    // Vermelho, em BGRA.
    expect(result.shown).toBe('1280x800 0,0,204,255');
    expect(result.minimized).toBe('1280x800 0,0,204,255');
    expect(result.focusedIsSupport).toBe(false);
    expect(result.x).toBe(-30000);
    expect(result.y).toBe(-30000);
  });
});
