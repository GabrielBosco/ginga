FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
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
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
