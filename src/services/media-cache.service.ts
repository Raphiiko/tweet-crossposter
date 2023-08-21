import { Injectable } from '@nestjs/common';
import https from 'https';
import { IncomingMessage } from 'http';
import fs from 'fs';
import { rimrafSync } from 'rimraf';

@Injectable()
export class MediaCacheService {
  private cache: Map<string, string> = new Map();

  constructor() {
    rimrafSync(`${__dirname}/MediaCache`);
    fs.mkdirSync(`${__dirname}/MediaCache`);
  }

  public getFilePathForUrl(url: string) {
    if (this.cache.has(url)) return this.cache.get(url);
    throw 'MEDIA_NOT_CACHED';
  }

  public async cacheMedia(url: string): Promise<string> {
    if (this.cache.has(url)) return this.cache.get(url);
    const response: IncomingMessage = await new Promise((res) =>
      https.get(url, (response) => res(response)),
    );
    const fileName = url.split('/').pop().split('#')[0].split('?')[0];
    const path = `${__dirname}/MediaCache/${fileName}`;
    const filePath = fs.createWriteStream(path);
    response.pipe(filePath);
    await new Promise((res) => filePath.on('finish', res));
    filePath.close();
    this.cache.set(url, path);
    return path;
  }

  public uncacheMedia(url: string) {
    if (!this.cache.has(url)) return;
    fs.unlinkSync(this.cache.get(url));
    this.cache.delete(url);
  }
}
