import { expect, test, vi } from 'vitest';
import { deviceSide, fitWithin } from '../src/lib/images.ts';

test('fitWithin', () => {
  expect(fitWithin(1024, 512, 256)).toEqual({ w: 256, h: 128 });
  expect(fitWithin(100, 300, 256)).toEqual({ w: 85, h: 256 });
  expect(fitWithin(100, 50, 256)).toEqual({ w: 100, h: 50 });
  expect(fitWithin(10000, 10, 256)).toEqual({ w: 256, h: 1 }); // never rounds a side to 0
});

// A map image is stored large and decoded to what each device can hold: desktops 8192 px a side, phones and tablets by memory;
// iOS (no deviceMemory, a 4096² canvas cap) 4096.
test('the side a device decodes a map image to', () => {
  const at = (maxTouchPoints: number, deviceMemory?: number) => { vi.stubGlobal('navigator', { maxTouchPoints, ...(deviceMemory !== undefined && { deviceMemory }) }); return deviceSide(); };
  expect([at(0), at(5, 8), at(5, 4), at(5, 2), at(5)]).toEqual([8192, 8192, 4096, 2048, 4096]);
  vi.unstubAllGlobals();
});
