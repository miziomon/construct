import { describe, expect, it } from 'vitest';
import { explain } from './importFile';

describe('explain', () => {
  it('traduce gli stati del kernel in messaggi leggibili, con o senza spazi', () => {
    expect(explain('Not manifold')).toContain('non è un solido chiuso');
    expect(explain('NotManifold')).toContain('non è un solido chiuso');
    expect(explain('NegativeVolume')).toContain('rivolte verso l\'interno');
    expect(explain('EmptyMesh')).toContain('non contiene geometria');
  });

  it('per gli stati sconosciuti riporta lo stato originale', () => {
    expect(explain('Non Finite Vertex')).toContain('Non Finite Vertex');
  });
});
