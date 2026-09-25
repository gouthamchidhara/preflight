import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App.js';

describe('App shell', () => {
  it('renders the console heading', () => {
    const html = renderToString(<App />);
    expect(html).toContain('UMD Validation Console');
  });
});
