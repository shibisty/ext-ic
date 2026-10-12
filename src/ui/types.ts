import type { ItemOverrides } from '../core/settings';
import type { ItemStatus } from '../platform/queue-db';

export interface QueueItem {
  id: string;
  file: Blob;
  name: string;
  ext: string;
  sizeBytes: number;
  addedAt: number;
  status: ItemStatus;
  resultBlob: Blob | null;
  resultName: string;
  resultSize: number;
  error: string;
  thumbUrl: string;
  expanded: boolean;
  naturalWidth: number | null;
  naturalHeight: number | null;
  overrides: ItemOverrides;
}
