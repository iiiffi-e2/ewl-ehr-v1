FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig*.json ./
COPY prisma ./prisma
COPY src ./src

RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY prisma ./prisma

EXPOSE 8080

CMD ["node", "dist/http/server.js"]
