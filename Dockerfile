FROM node:22-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data
WORKDIR /app
COPY package.json *.js ./
COPY public ./public
# Läuft als root, weil Railway-Volumes root gehören. Die Datenbank liegt im Volume unter /data.
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
