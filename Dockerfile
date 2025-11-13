FROM node:20-alpine AS build
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig*.json ./
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY public ./public

RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 8080

# Run migrations and start the application
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/http/server.js"]
