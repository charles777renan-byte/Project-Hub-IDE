# ADR 0001: Electron com renderer isolado

- Status: aceita
- Data: 2026-10-19
- Origem: seção 8.6 do planejamento (ADR-001)

## Contexto

O aplicativo precisa de integração nativa (pastas, Git, processos) sem expor o sistema à interface web.

## Decisão

Usar Electron com o renderer isolado do Node.js: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` e `webSecurity: true`. O renderer fala com o processo principal só por uma API pequena do preload, exposta com `contextBridge`.

Justificativa da seção 8.6: oferece integração nativa mantendo fronteira de segurança.

## Consequência

Arquivos, Git, banco e segredos existem só no processo principal. Toda chamada do renderer passa por canais IPC tipados e validados com Zod, sem `ipcRenderer.send` nem `invoke` genéricos (seções 8.2, 13.4 e 24.4).
