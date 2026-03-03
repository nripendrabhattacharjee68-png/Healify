FROM node:22-alpine AS base

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY data ./data

ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/app/data/helify_mvp.db

EXPOSE 8787

CMD ["node", "src/server.js"]
