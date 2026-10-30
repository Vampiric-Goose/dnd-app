import type { EntityKind } from '../types.ts';

export const slug = (s: string): string =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const entityId = (kind: EntityKind, name: string, source: string): string =>
  `${kind}:${slug(name)}@${source.toUpperCase()}`;

export const featureId = (className: string, subclassShortName: string | undefined, name: string, level: number, source: string): string =>
  `feature:${[className, subclassShortName, name].filter(x => x !== undefined).map(slug).join(':')}:${level}@${source.toUpperCase()}`;

const at = (id: string) => id.lastIndexOf('@');
export const baseKey = (id: string): string => (at(id) < 0 ? id : id.slice(0, at(id)));
export const sourceOf = (id: string): string => (at(id) < 0 ? '' : id.slice(at(id) + 1));
