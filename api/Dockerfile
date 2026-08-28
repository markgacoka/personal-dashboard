FROM node:20-alpine

WORKDIR /app

# Build context is repo root, so paths reference top-level dirs
COPY api/package.json api/package-lock.json* ./
RUN npm ci --omit=dev

COPY api/src/ ./src/
COPY public/ ./public/

ENV PUBLIC_DIR=/app/public
ENV SESSION_DIR=/data/garmin-session
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/index.js"]
