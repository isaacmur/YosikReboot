import { describe, expect, it } from 'vitest';
import { Anonymizer, findLeaks } from '../scripts/probe/anonymize';
import { REDACTED } from '../scripts/probe/scrub';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CLIENT = '3f69e56c7649492c8cc29f1af08a8a12';

describe('Anonymizer', () => {
  it('replaces account IDs everywhere with consistent stand-ins, including inside strings and keys', () => {
    const anon = new Anonymizer();
    const out = anon.value({
      teamAccountIds: [A, B],
      teamId: `${A}:${B}`,
      playerFlagTokens: { [A]: 'GroupIdentity_GeoIdentity_france' },
      url: `https://x/leaderboards/Fortnite/e/w/${B}?teamAccountIds=${A}`,
    });
    const a = 'f0000000000000000000000000000001';
    const b = 'f0000000000000000000000000000002';
    expect(out).toEqual({
      teamAccountIds: [a, b],
      teamId: `${a}:${b}`,
      playerFlagTokens: { [a]: `GroupIdentity_GeoIdentity_${REDACTED}` },
      url: `https://x/leaderboards/Fortnite/e/w/${b}?teamAccountIds=${a}`,
    });
    // Same instance, later file: same mapping.
    expect(anon.value([{ id: B }])).toEqual([{ id: b }]);
    expect(anon.counts).toEqual({ ids: 2, names: 0 });
  });

  it('catches IDs after an encoded comma in a URL', () => {
    const out = new Anonymizer().value({ url: `https://x/lb?teamAccountIds=${A}%2C${B}&appId=Fortnite` }) as {
      url: string;
    };
    expect(out.url).toBe(
      'https://x/lb?teamAccountIds=f0000000000000000000000000000001%2Cf0000000000000000000000000000002&appId=Fortnite',
    );
  });

  it('keeps public IDs and leaves non-ID text alone', () => {
    const anon = new Anonymizer({ keepIds: [CLIENT] });
    const doc = { client_id: CLIENT, eventId: 'epicgames_S42_FNCSSolo_Final_NAC', long: `${A}${A}`, rank: 3 };
    expect(anon.value(doc)).toEqual(doc);
  });

  it('replaces display names, including the one in a lookup URL', () => {
    const anon = new Anonymizer();
    const out = anon.value({
      bulk: [{ id: A, displayName: 'RealPlayer' }],
      self: { displayName: 'My Alt' },
      url: 'https://acct/account/api/public/account/displayName/My%20Alt',
    });
    expect(out).toEqual({
      bulk: [{ id: 'f0000000000000000000000000000001', displayName: 'Player00001' }],
      self: { displayName: 'Player00002' },
      url: 'https://acct/account/api/public/account/displayName/Player00002',
    });
  });

  it('redacts spectate tokens but keeps empty ones empty', () => {
    const anon = new Anonymizer();
    expect(anon.value([{ liveSpectateAccessToken: 'Xy12abc' }, { liveSpectateAccessToken: '' }])).toEqual([
      { liveSpectateAccessToken: REDACTED },
      { liveSpectateAccessToken: '' },
    ]);
  });

  it('is idempotent: running it on its own output changes nothing', () => {
    const doc = { teamAccountIds: [A], displayName: 'Someone', flag: 'GroupIdentity_GeoIdentity_usa' };
    const once = new Anonymizer().value(doc);
    expect(new Anonymizer().value(once)).toEqual(once);
  });
});

describe('findLeaks', () => {
  const raw = [
    { url: `https://x?teamAccountIds=${A}%2C${B}`, displayName: 'RealName', flag: 'GroupIdentity_GeoIdentity_france' },
    { metadata: { liveSpectateAccessToken: 'SpectateCode1' }, client_id: CLIENT },
  ];

  it('reports nothing for properly anonymized output', () => {
    const anon = new Anonymizer({ keepIds: [CLIENT] });
    const text = raw.map((d) => JSON.stringify(anon.value(d))).join('\n');
    expect(findLeaks(raw, text, [CLIENT])).toEqual({ ids: 0, names: 0, countries: 0, tokens: 0 });
  });

  it('counts each kind of leak independently of the anonymizer', () => {
    const text = JSON.stringify({
      x: `${B}`,
      n: 'RealName',
      f: 'GroupIdentity_GeoIdentity_france',
      t: 'SpectateCode1',
    });
    expect(findLeaks(raw, text, [CLIENT])).toEqual({ ids: 1, names: 1, countries: 1, tokens: 1 });
  });

  it('does not count kept public IDs', () => {
    expect(findLeaks(raw, CLIENT, [CLIENT]).ids).toBe(0);
  });
});
