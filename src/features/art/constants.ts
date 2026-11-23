import type { HangType, PieceStatus } from '../../domain/types.ts';

export const STATUS_LABEL: Record<PieceStatus, string> = {
  idea: 'Idea',
  owned: 'Owned',
  planned: 'Planned',
  hung: 'Hung',
  storage: 'In storage',
};
export const STATUSES = Object.keys(STATUS_LABEL) as PieceStatus[];

export const HANG_LABEL: Record<HangType, string> = {
  sawtooth: 'Sawtooth hanger',
  wire: 'Picture wire',
  dring2: 'Two D-rings',
  custom: 'Other (single hook)',
};
export const HANG_TYPES = Object.keys(HANG_LABEL) as HangType[];
