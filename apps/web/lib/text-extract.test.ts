import { describe, it, expect } from 'vitest';
import { stripHtml, isBlockedUrl, extractUploadedFileText } from './text-extract';

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

describe('extractUploadedFileText — upload de fonte de conhecimento (.txt/.md/.csv/.pdf/.docx)', () => {
  it('lê arquivo de texto puro direto, sem biblioteca de extração', async () => {
    const file = new File(['VGV da Torre 3 é R$ 40 milhões, com margem de 22%.'], 'nota.txt', {
      type: 'text/plain',
    });
    await expect(extractUploadedFileText(file)).resolves.toBe(
      'VGV da Torre 3 é R$ 40 milhões, com margem de 22%.',
    );
  });

  it('rejeita formato não suportado (.doc antigo, .xlsx etc.)', async () => {
    const file = new File(['conteúdo qualquer'], 'planilha.xlsx');
    await expect(extractUploadedFileText(file)).rejects.toThrow(/Formato não suportado/);
  });

  it('rejeita texto curto demais para virar conhecimento', async () => {
    const file = new File(['oi'], 'nota.txt');
    await expect(extractUploadedFileText(file)).rejects.toThrow(/texto útil/);
  });

  it('rejeita arquivo de texto acima do limite de 2 MB', async () => {
    const big = 'a'.repeat(2 * 1024 * 1024 + 1);
    const file = new File([big], 'grande.txt');
    await expect(extractUploadedFileText(file)).rejects.toThrow(/grande demais/);
  });
});
