# Distribuição

1. Sincronize `package.json`, `package-lock.json` e a seção `## X.Y.Z — Título` em `CHANGELOG.md`.
2. Execute os testes e confirme que **Build desktop** passou no Linux e no Windows.
3. Em uma release com a tag `vX.Y.Z`, anexe o AppImage, o pacote DEB, o instalador NSIS, seu `.blockmap`, `latest-linux.yml`, `latest.yml` e `SHA256SUMS.txt`.
4. Não renomeie arquivos depois de gerar os metadados. Os campos `path`, `sha512` e `size` devem corresponder aos instaladores anexados.
5. Crie a release inicialmente como rascunho e publique-a como estável e **Latest** somente após verificar os anexos.

Os pacotes de distribuição não incluem o binário FFmpeg. O teste `scripts/smoke-release.cjs` abre o aplicativo empacotado, converte uma imagem antes de instalar o motor, valida o download do motor e testa áudio e os modos de vídeo MP4. O workflow Windows executa o instalador NSIS em modo silencioso antes desse teste. Veja [avisos de terceiros](../THIRD_PARTY_NOTICES.md).
