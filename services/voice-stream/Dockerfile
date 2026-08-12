FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8081

COPY services/voice-stream/package.json services/voice-stream/package-lock.json ./
RUN npm ci --omit=dev

COPY services/voice-stream/server.cjs services/voice-stream/protocol.cjs ./

USER node
EXPOSE 8081
CMD ["node", "server.cjs"]
