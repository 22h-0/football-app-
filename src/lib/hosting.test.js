import { describe, expect, it } from 'vitest';
import { usesSharedWebsite } from './hosting.js';

describe('shared tournament hosting mode', () => {
  it('keeps Cloudflare-hosted tournaments on the server even with a default frontend build', () => {
    expect(usesSharedWebsite({ protocol: 'https:', hostname: 'sideline.organizer.workers.dev' })).toBe(true);
  });
  it('retains the explicit shared build on custom domains', () => {
    expect(usesSharedWebsite({ protocol: 'https:', hostname: 'club.example' }, true)).toBe(true);
  });
  it('keeps downloaded files local even if the shared flag was set', () => {
    expect(usesSharedWebsite({ protocol: 'file:', hostname: '' }, true)).toBe(false);
  });
  it('preserves local development and does not mistake lookalike domains for Cloudflare', () => {
    for (const hostname of ['localhost', '127.0.0.1', 'workers.dev.example']) {
      expect(usesSharedWebsite({ protocol: 'https:', hostname })).toBe(false);
    }
  });
});
