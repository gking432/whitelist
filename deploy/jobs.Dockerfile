FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY deploy/run-jobs.mjs ./run-jobs.mjs
USER node
CMD ["node", "run-jobs.mjs"]
