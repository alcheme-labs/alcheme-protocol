FROM node:20-alpine AS builder

WORKDIR /app

COPY extensions/contribution-engine/tracker/package*.json ./
COPY extensions/contribution-engine/tracker/tsconfig.json ./

RUN npm ci

COPY extensions/contribution-engine/tracker/src ./src

RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY extensions/contribution-engine/tracker/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY extensions/contribution-engine/tracker/idl ./idl

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
