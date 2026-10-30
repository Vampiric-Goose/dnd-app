// Pure: splits an import's errors for display (unit-tested under Node).
export const NO_CONTENT = 'No recognised 5etools content';

/** Files with no recognised content (index, fluff, lists...) are expected in a 5etools folder: skipped, not errors. */
export function splitImportErrors(errors: { file: string; message: string }[]): { skipped: string[]; errors: { file: string; message: string }[] } {
  return {
    skipped: errors.filter((e) => e.message === NO_CONTENT).map((e) => e.file),
    errors: errors.filter((e) => e.message !== NO_CONTENT),
  };
}
