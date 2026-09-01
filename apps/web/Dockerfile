FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
ARG VITE_GITHUB_REPOSITORY_URL=""
ENV VITE_GITHUB_REPOSITORY_URL=$VITE_GITHUB_REPOSITORY_URL
RUN npm run build

# Alpine distro Nginx + modulo headers-more da MESMA arvore/versao.
# Isso permite remover o header Server, nao apenas esconder a versao.
FROM alpine:3.22
RUN apk add --no-cache \
      nginx=1.28.3-r7 \
      nginx-mod-http-headers-more=1.28.3-r7 \
    && rm -f /etc/nginx/http.d/default.conf \
    && mkdir -p /usr/share/nginx/html

COPY nginx-main.conf /etc/nginx/nginx.conf
ARG PUBLIC_LIVEKIT_URL=""
ARG LIVEKIT_DOMAIN=""
COPY nginx.conf /tmp/ginga-nginx.conf
RUN set -eu; \
    origins=""; \
    if [ -n "$LIVEKIT_DOMAIN" ]; then \
      origins="$origins https://$LIVEKIT_DOMAIN wss://$LIVEKIT_DOMAIN"; \
    fi; \
    if [ -n "$PUBLIC_LIVEKIT_URL" ]; then \
      scheme="${PUBLIC_LIVEKIT_URL%%://*}"; \
      rest="${PUBLIC_LIVEKIT_URL#*://}"; \
      authority="${rest%%/*}"; \
      case "$scheme" in \
        wss|https) origins="$origins https://$authority wss://$authority" ;; \
        ws|http) origins="$origins http://$authority ws://$authority" ;; \
      esac; \
    fi; \
    sed "s|__LIVEKIT_CONNECT_SRC__|$origins|g" /tmp/ginga-nginx.conf > /etc/nginx/http.d/default.conf; \
    rm -f /tmp/ginga-nginx.conf; \
    grep -q "connect-src 'self'" /etc/nginx/http.d/default.conf; \
    ! grep -q '__LIVEKIT_CONNECT_SRC__' /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
