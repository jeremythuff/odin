# syntax=docker/dockerfile:1
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY client/package.json ./package.json
RUN npm install --omit=dev

COPY client/. ./

EXPOSE 3000

CMD ["npm", "start"]
