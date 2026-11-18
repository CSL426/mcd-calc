# syntax=docker/dockerfile:1

# ── builder：型別檢查、跑測試、打包 ──
FROM node:26.13.1-alpine AS builder
WORKDIR /app

# Node 25 起不再內建 corepack，直接裝指定版本的 pnpm
RUN npm install -g pnpm@11.18.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# 測試沒過就不出 image
RUN pnpm test && pnpm build

# ── runner：nginx 直接提供打包好的靜態檔 ──
FROM nginx:1.30.6-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
