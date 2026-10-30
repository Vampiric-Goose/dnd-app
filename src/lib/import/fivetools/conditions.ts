import type { ConditionDef } from '../../types.ts';
import { base, type Raw } from './common.ts';

export const condition = (r: Raw, _ctx: unknown, id: string, name: string): ConditionDef => base('condition', id, name, r);
