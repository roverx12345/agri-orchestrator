ARG BASE_IMAGE=node:22-bookworm-slim
FROM ${BASE_IMAGE} AS build
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm install

COPY index.ts ./
COPY openclaw.plugin.json ./
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY skills ./skills
COPY examples ./examples
COPY README.md README.zh-CN.md BACKEND.md ./

RUN npm run build

FROM ${BASE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY src/backend/migrations ./dist/src/backend/migrations
COPY openclaw.plugin.json ./openclaw.plugin.json
COPY skills ./skills
COPY examples ./examples

CMD ["node", "./dist/src/backend/server.js"]
