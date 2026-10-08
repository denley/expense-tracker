# Expense tracker: the built app plus a single-file Node server (no runtime
# npm dependencies). Built and run on the home server by compose.yaml.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm test && pnpm build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8098 BASE_PATH=/expense-tracker \
    DATA_DIR=/data STATIC_DIR=/app/dist TZ=Australia/Adelaide
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist/main.mjs ./server/main.mjs
USER node
EXPOSE 8098
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8098/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/main.mjs"]
