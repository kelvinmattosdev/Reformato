# Histórico de versões

## 1.0.1 — MP4 mais rápido sem placa de vídeo

- Modo Automático reaproveita vídeo H.264 ou HEVC em MOV, M4V e MKV compatíveis, convertendo apenas o áudio quando necessário.
- Novos modos Compatível (H.264 na resolução de entrada) e Leve (até 720p, com menos threads).
- A fila informa quando está copiando, recodificando ou salvando e mostra o progresso quando a duração está disponível.
- Preset H.264 mais rápido e prioridade reduzida para o FFmpeg, dando mais espaço a outros apps enquanto a fila roda.

## 1.0.0 — Primeira versão estável

- Pacotes para Linux x64 (AppImage e DEB) e Windows x64 (instalador NSIS).
- Conversão em lote de imagens, áudios e vídeos, com escolha por arquivo ou por lote.
- Suporte a 9 extensões de imagem, 30 de áudio e 31 de vídeo, incluindo extensões alternativas.
- Pasta de saída digitada ou selecionada, sem substituir os arquivos originais.
- Temas claro, escuro e do sistema, novo ícone e lista de extensões por categoria.
- Instalação opcional do FFmpeg na primeira conversão de áudio, vídeo ou BMP, com verificação por SHA-256.
- Histórico no aplicativo e atualizações pelo GitHub Releases.

## 0.1.0 — Primeira versão

- Conversão local e em lote de imagens, áudios e vídeos.
- Mais formatos de imagem, incluindo saída JPEG, AVIF, BMP, TIFF/TIF e GIF estático. WebP converte para PNG ou JPG.
- Catálogo ampliado para 30 extensões de áudio e 31 de vídeo, com as opções de áudio e vídeo separadas no seletor.
- Consulta dos formatos compatíveis ao passar o mouse ou focar em Imagem, Áudio e Vídeo na fila vazia.
- Monograma do Reformato no cabeçalho e no ícone do aplicativo.
- Seleção de formato por arquivo ou por lote e acompanhamento da fila.
- Pasta de saída digitada ou selecionada, com caminho completo visível e sem substituir arquivos existentes.
- Temas claro, escuro e do sistema.
- Histórico no aplicativo e verificação de novas versões no GitHub Releases.
- A verificação de versões funciona sem saída de terminal ao abrir pelo menu de aplicativos.
