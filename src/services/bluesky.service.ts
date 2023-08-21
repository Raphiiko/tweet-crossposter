import { Injectable } from '@nestjs/common';
import { BskyAgent, ComAtprotoRepoUploadBlob } from '@atproto/api';
import { BehaviorSubject } from 'rxjs';
import { AppBskyFeedPost } from '@atproto/api/src/client';
import fs from 'fs';
import mime from 'mime';

@Injectable()
export class BlueskyService {
  public readonly agent: BskyAgent;
  private _initialized = new BehaviorSubject<boolean>(false);
  public initialized = this._initialized.asObservable();

  constructor() {
    this.agent = new BskyAgent({ service: 'https://bsky.social' });
    this.init();
  }

  private async init() {
    if (this._initialized.value) return;
    console.log('Initializing Bluesky Service...');
    try {
      await this.agent.login({
        identifier: process.env.BLUESKY_USER_HANDLE,
        password: process.env.BLUESKY_USER_PASSWORD,
      });
      console.log('Logged in to Bluesky');
      console.log('Bluesky Service Initialized');
      this._initialized.next(true);
    } catch (e) {
      console.log('Could not log in to Bluesky: ' + e);
    }
  }

  public async post(
    post: Partial<AppBskyFeedPost.Record> &
      Omit<AppBskyFeedPost.Record, 'createdAt'>,
  ) {
    if (!this._initialized.value) throw 'NOT_INITIALIZED';
    await this.agent.post(post);
  }

  public async uploadImage(
    filePath: string,
  ): Promise<ComAtprotoRepoUploadBlob.Response> {
    const file = fs.readFileSync(filePath);
    const mime_type = mime.getType(filePath);
    if (mime_type !== 'image/jpeg' && mime_type !== 'image/png')
      throw 'UNSUPPORTED_FILE_TYPE';
    return this.agent.uploadBlob(file, { encoding: mime_type });
  }
}
