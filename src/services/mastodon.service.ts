import { Injectable } from '@nestjs/common';
import { BehaviorSubject } from 'rxjs';
import generator, { MegalodonInterface } from 'megalodon';
import fs from 'fs';

export interface MastodonPostOptions {
  media_ids?: Array<string>;
  poll?: {
    options: Array<string>;
    expires_in: number;
    multiple?: boolean;
    hide_totals?: boolean;
  };
  in_reply_to_id?: string;
  sensitive?: boolean;
  spoiler_text?: string;
  visibility?: 'public' | 'unlisted' | 'private' | 'direct';
  scheduled_at?: string;
  language?: string;
  quote_id?: string;
}

@Injectable()
export class MastodonService {
  private client: MegalodonInterface;
  private _initialized = new BehaviorSubject<boolean>(false);
  public initialized = this._initialized.asObservable();

  constructor() {
    this.init();
  }

  private async init() {
    if (this._initialized.value) return;
    console.log('Initializing Mastodon Service...');
    this.client = generator(
      'mastodon',
      process.env.MASTODON_INSTANCE_URL,
      process.env.MASTODON_ACCESS_TOKEN,
    );
    console.log('Mastodon Service Initialized');
    this._initialized.next(true);
  }

  public async post(status: string, options?: MastodonPostOptions) {
    if (!this._initialized.value) throw 'NOT_INITIALIZED';
    return this.client.postStatus(status, options || {});
  }

  public async uploadMedia(
    filePath: any,
    options?: {
      description?: string;
      focus?: string;
    },
  ): Promise<Entity.Attachment | Entity.AsyncAttachment> {
    const file = fs.createReadStream(filePath);
    const result = await this.client.uploadMedia(
      file,
      options ?? {
        description: '',
        focus: '0.0,0.0',
      },
    );
    return result.data;
  }
}
