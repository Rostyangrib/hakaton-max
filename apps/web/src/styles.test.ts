import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('styles.css responsive and containment layout rules', () => {
  const cssPath = path.resolve(__dirname, 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  it('enforces min-width: 0 on inputs to prevent horizontal blowout', () => {
    expect(css).toMatch(/input,\s*textarea,\s*select\s*\{[^}]*min-width:\s*0/);
  });

  it('uses mobile-first single column for .grid-two by default', () => {
    // .grid-two must default to 1fr
    expect(css).toMatch(/\.grid-two\s*\{[^}]*grid-template-columns:\s*1fr;/);
  });

  it('switches to two columns only on wider viewports (min-width: 440px)', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*440px\)\s*\{[\s\S]*?\.grid-two\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('isolates field inputs and containers with width: 100% and min-width: 0', () => {
    expect(css).toMatch(/\.field\s*>\s*div,\s*\.field\s*input\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.grid-two\s*>\s*\*\s*\{[^}]*min-width:\s*0/);
  });

  it('does not force two columns in the max-width: 360px media query', () => {
    const narrowQueryMatch = css.match(/@media\s*\(max-width:\s*360px\)\s*\{([\s\S]*?)\}/);
    expect(narrowQueryMatch).not.toBeNull();
    const narrowQueryBody = narrowQueryMatch![1];
    expect(narrowQueryBody).not.toMatch(/grid-template-columns:\s*1fr\s+1fr/);
  });
});
