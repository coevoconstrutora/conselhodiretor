import { describe, it, expect } from 'vitest';
import { stripHtml, isBlockedUrl } from './text-extract';

describe('stripHtml — extração de texto de páginas', () => {
  it('remove tags, scripts e styles preservando o texto', () => {
    const html = `
      <html><head><style>body{color:red}</style>
      <script>alert('x')</script></head>
      <body><h1>Relatório do Setor</h1>
      <p>VSO médio de <b>8%</b> ao mês.</p>
      <ul><li>Item um</li><li>Item dois</li></ul></body></html>`;
    const text = stripHtml(html);
    expect(text).toContain('Relatório do Setor');
    expect(text).toContain('VSO médio de 8% ao mês.');
    expect(text).toContain('Item um');
    expect(text).not.toContain('<');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('converte quebras estruturais (p, li, br) em novas linhas', () => {
    const text = stripHtml('<p>linha um</p><p>linha dois</p>');
    expect(text.split('\n').map((l) => l.trim())).toEqual(['linha um', 'linha dois']);
  });

  it('decodifica entidades HTML comuns', () => {
    expect(stripHtml('R&amp;D &lt;teste&gt; &quot;aspas&quot;')).toBe('R&D <teste> "aspas"');
  });
});

describe('isBlockedUrl — guarda anti-SSRF do importador de links', () => {
  it('permite URLs públicas http/https', () => {
    expect(isBlockedUrl('https://www.cbic.org.br/relatorio')).toBe(false);
    expect(isBlockedUrl('http://exemplo.com/pagina')).toBe(false);
  });

  it('bloqueia alvos privados e loopback', () => {
    for (const url of [
      'http://localhost:3000/admin',
      'http://127.0.0.1/secret',
      'http://10.0.0.5/interno',
      'http://192.168.1.1/router',
      'http://172.16.0.1/infra',
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://servico.internal/x',
      'http://impressora.local/x',
    ]) {
      expect(isBlockedUrl(url), url).toBe(true);
    }
  });

  it('bloqueia protocolos não-http e strings inválidas', () => {
    expect(isBlockedUrl('file:///etc/passwd')).toBe(true);
    expect(isBlockedUrl('ftp://servidor/arquivo')).toBe(true);
    expect(isBlockedUrl('não é url')).toBe(true);
  });
});
