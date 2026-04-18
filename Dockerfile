FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json package-scripts.js ./
RUN npm ci

FROM deps AS build
WORKDIR /app

COPY app.ts app.email-worker.ts ./
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./
COPY environments ./environments
RUN npm run build

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json package-scripts.js ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/environments ./environments
COPY package.json package-lock.json package-scripts.js ./

RUN mkdir -p /app/storage/activity-exports

CMD ["node", "dist/app.js"]
