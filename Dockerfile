# Abhängigkeiten in einem eigenen Stage installieren, damit npm nicht im fertigen Image landet.
FROM node:24-alpine AS deps
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine

# npm, npx und corepack braucht der Bot zur Laufzeit nicht. Sie bringen eigene Abhängigkeiten
# mit (z.B. undici, brace-expansion), die sonst im Image-Scan auftauchen.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

CMD ["node", "src/index.js"]
