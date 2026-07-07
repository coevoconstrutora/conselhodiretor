import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptField, decryptField, loadEncryptionKey, generateEncryptionKey } from './aes-gcm';

const key = randomBytes(32);

describe('AES-256-GCM field encryption', () => {
  it('faz round-trip (encrypt → decrypt) preservando o texto', () => {
    const plaintext = 'Paciente Maria — hipertensão (sigiloso)';
    const cipher = encryptField(plaintext, key);
    expect(decryptField(cipher, key)).toBe(plaintext);
  });

  it('NÃO deixa o texto legível em claro no payload cifrado (NFR9)', () => {
    const plaintext = 'dado-clinico-secreto';
    const cipher = encryptField(plaintext, key);
    expect(cipher).not.toContain(plaintext);
    expect(Buffer.from(cipher, 'base64').toString('utf8')).not.toContain(plaintext);
  });

  it('gera IV aleatório — mesmo texto produz ciphertexts distintos', () => {
    const plaintext = 'mesmo-texto';
    expect(encryptField(plaintext, key)).not.toBe(encryptField(plaintext, key));
  });

  it('detecta adulteração (GCM tamper-evident)', () => {
    const cipher = encryptField('integro', key);
    const bytes = Buffer.from(cipher, 'base64');
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 0x01; // corrompe 1 bit do ciphertext
    expect(() => decryptField(bytes.toString('base64'), key)).toThrow();
  });

  it('falha ao decifrar com chave errada', () => {
    const cipher = encryptField('segredo', key);
    expect(() => decryptField(cipher, randomBytes(32))).toThrow();
  });

  it('rejeita chave com tamanho inválido', () => {
    expect(() => encryptField('x', randomBytes(16))).toThrow(/32 bytes/);
  });

  it('loadEncryptionKey valida presença e tamanho da chave', () => {
    expect(() => loadEncryptionKey({})).toThrow(/ausente/);
    expect(() => loadEncryptionKey({ DATA_ENCRYPTION_KEY: 'dG9vc2hvcnQ=' })).toThrow(/inválida/);
    const valid = generateEncryptionKey();
    expect(loadEncryptionKey({ DATA_ENCRYPTION_KEY: valid }).length).toBe(32);
  });
});
