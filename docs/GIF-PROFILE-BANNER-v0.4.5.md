# Ginga 0.4.5 - GIF em avatar, banner e icones

## O que foi corrigido

O frontend bloqueava `image/gif` em alguns seletores e o pipeline de canvas convertia a imagem para WebP, preservando apenas um frame. A API de perfil e de aparencia do servidor tambem aceitava somente `image/webp`.

Agora:

- avatar global do usuario: GIF ate 8 MB;
- banner global do usuario: GIF ate 12 MB;
- icone do servidor: GIF ate 8 MB;
- banner do servidor: GIF ate 12 MB;
- avatar/banner do perfil por servidor: GIF ate 8/12 MB;
- emoji e sticker do servidor e aparencia do forum continuam com o suporte GIF que ja existia;
- emoji personalizado local agora tambem preserva GIF animado (ate 512 KB).

GIF e armazenado no formato original para manter todos os frames. PNG/JPG/WebP continuam passando pelo processamento WebP existente. A API verifica a assinatura real do arquivo e as dimensoes declaradas do GIF antes de persistir.
