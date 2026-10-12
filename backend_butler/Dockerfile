# Builds from source, so installing from the GitHub repository needs nothing prebuilt.
ARG BUILD_FROM=ghcr.io/home-assistant/base:3.24

FROM ${BUILD_FROM} AS build
RUN apk add --no-cache nodejs npm
WORKDIR /src
COPY package.json package-lock.json ./
# No dependency needs an install script (esbuild's only picks its binary, which comes as an optional package).
# Installing inside Alpine selects the SDK's musl binary.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM ${BUILD_FROM}
# Runtime needs node only: no npm, no build tools.
RUN apk add --no-cache nodejs
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist/server.mjs ./dist/server.mjs
COPY --from=build /src/dist/web ./dist/web
# Bundled skills (self-contained SKILL.md files; see skills/NOTICE.md).
COPY skills ./skills
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
