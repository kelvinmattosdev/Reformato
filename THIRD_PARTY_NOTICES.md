# Componentes de terceiros

O Reformato usa dependências de terceiros sujeitas às suas próprias licenças.

| Componente | Licença e código-fonte |
| --- | --- |
| Electron e Chromium | [Electron](https://github.com/electron/electron/tree/v45.4.1) (MIT) e [Chromium](https://chromium.googlesource.com/chromium/src/). Os pacotes do Electron incluem `LICENSE.electron.txt` e `LICENSES.chromium.html`. |
| React, Lucide e electron-updater | [React](https://github.com/facebook/react) (MIT), [Lucide](https://github.com/lucide-icons/lucide) (ISC) e [electron-updater](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater) (MIT). |
| Sharp e libvips | [Sharp](https://github.com/lovell/sharp/tree/v0.34.5) (Apache-2.0), [libvips](https://github.com/libvips/libvips/tree/v8.17.3) (LGPL-2.1-or-later) e [receitas de compilação](https://github.com/lovell/sharp-libvips). Os avisos das bibliotecas também acompanham os respectivos pacotes npm. |

## FFmpeg, instalado separadamente

Os instaladores do Reformato não incluem o binário FFmpeg. Ao escolher **Baixar motor de conversão**, o app baixa o executável diretamente dos [artefatos upstream do ffmpeg-static `b6.1.1`](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1), valida o SHA-256 e o chama como processo separado.

Essas compilações são GPLv3 e mantêm as condições dos seus distribuidores: [John Van Sickle — Linux](https://johnvansickle.com/ffmpeg/) e [Gyan Doshi — Windows](https://www.gyan.dev/ffmpeg/builds/). Os avisos originais estão disponíveis para [Linux](https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/linux-x64.LICENSE) e [Windows](https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/win32-x64.LICENSE). Veja também [FFmpeg: licença e código-fonte](https://ffmpeg.org/legal.html).
