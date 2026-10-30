import type { OptionalFeatureDef } from '../../types.ts';
import { arr, base, code, prereqText, type Raw } from './common.ts';

export const optionalFeature = (r: Raw, _ctx: unknown, id: string, name: string): OptionalFeatureDef => {
  const prerequisite = prereqText(r.prerequisite);
  return { ...base('optionalFeature', id, name, r), featureTypes: arr(r.featureType).map(code), ...(prerequisite && { prerequisite }) };
};
