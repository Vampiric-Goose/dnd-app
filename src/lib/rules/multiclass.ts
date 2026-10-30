import type { MulticlassPrereq, Scores } from '../types.ts';
import { ABILITIES } from './constants.ts';

/** `all`: every listed score must reach its minimum; `any`: at least one must. No prereq always passes. */
export function meetsMulticlassPrereq(p: MulticlassPrereq | undefined, s: Scores): boolean {
  const checks = (req: Partial<Scores> = {}) => ABILITIES.filter((a) => req[a] !== undefined).map((a) => s[a] >= req[a]!);
  const any = checks(p?.any);
  return checks(p?.all).every(Boolean) && (any.length === 0 || any.some(Boolean));
}
