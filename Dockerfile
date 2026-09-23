# ---- deps stage: install production dependencies ----
FROM node:24-alpine AS deps
RUN apk update && apk upgrade --no-cache
WORKDIR /app
COPY app/package*.json ./
RUN npm ci --omit=dev

# ---- final stage: minimal runtime image ----
FROM node:24-alpine
RUN apk update && apk upgrade --no-cache
WORKDIR /app

# Build-time metadata, set from CI. Both have safe fallbacks in server.js
# for local `docker build` runs where these aren't passed.
ARG GIT_SHA=unknown
ARG APP_VERSION=unknown
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}

# Copy only the installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY --chown=node:node app/ .

# Remove npm and npx — not needed at runtime, and their bundled
# dependencies are the source of unfixable CVEs (brace-expansion, tar, etc.)
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /opt/yarn* 2>/dev/null || true

USER node
EXPOSE 3000
CMD ["node", "server.js"]