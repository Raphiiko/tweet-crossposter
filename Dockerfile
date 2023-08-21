FROM node:18
RUN apt-get update
RUN apt-get install -y xvfb
RUN apt-get install gnupg wget -y && \
    wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    apt-get update && \
    apt-get install google-chrome-stable -y --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV TWITTER_USER_ID=""
ENV TWITTER_USER_HANDLE=""
ENV TWITTER_LOGIN_EMAIL=""
ENV TWITTER_LOGIN_HANDLE=""
ENV TWITTER_LOGIN_PASSWORD=""
ENV BLUESKY_USER_HANDLE=""
ENV BLUESKY_USER_PASSWORD=""
ENV PUPPETEER_PATH_USER_DATA="/data/puppeteer"
ENV PERSISTENT_DATA_PATH="/data/cache"
ENV MASTODON_INSTANCE_URL=""
ENV MASTODON_ACCESS_TOKEN=""
ENV SYNC_INTERVAL=900000
ENV SYNC_AFTER_TIMESTAMP=0
CMD xvfb-run --server-args="-screen 0 1024x768x24" npm run start-docker
