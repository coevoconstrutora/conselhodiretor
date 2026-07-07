import { describe, it, expect } from 'vitest';
import { stripJsonFences } from './json';

describe('stripJsonFences (helper único de parsing de LLM)', () => {
  it('remove cerca ```json … ```', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('remove cerca sem rótulo de linguagem', () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('rótulo em maiúsculas (```JSON)', () => {
    expect(stripJsonFences('```JSON\n{"a":1}```')).toBe('{"a":1}');
  });

  it('sem cerca: apenas apara espaços', () => {
    expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}');
  });
});
