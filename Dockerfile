FROM node:22-alpine

WORKDIR /app

RUN npm install --global pnpm@12.5.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

EXPOSE 3000 5173

CMD ["pnpm", "--filter", "@quiet-chat/api", "start"]

