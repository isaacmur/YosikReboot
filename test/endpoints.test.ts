import { describe, expect, it } from 'vitest';
import { BULK_ACCOUNT_LIMIT, chunk, endpoints, HOSTS } from '../lib/epic/endpoints';

describe('endpoints', () => {
  it('builds the leaderboard URL with default paging and joined team IDs', () => {
    const url = new URL(endpoints.leaderboard('epicgames_S23_Cup_EU', 'S23_Cup_Event9_EU', 'acc', { page: 2, teamAccountIds: ['a', 'b'] }));
    expect(url.origin).toBe(HOSTS.events);
    expect(url.pathname).toBe('/api/v1/leaderboards/Fortnite/epicgames_S23_Cup_EU/S23_Cup_Event9_EU/acc');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      rank: '0',
      teamAccountIds: 'a,b',
      appId: 'Fortnite',
      showLiveSessions: 'false',
    });
  });

  it('encodes path segments', () => {
    expect(endpoints.accountByName('Yosik Reboot/1')).toBe(
      `${HOSTS.account}/account/api/public/account/displayName/Yosik%20Reboot%2F1`,
    );
  });

  it('omits undefined query params', () => {
    expect(endpoints.eventsDownload('acc', { region: 'NAE', platform: undefined })).toBe(
      `${HOSTS.events}/api/v1/events/Fortnite/download/acc?region=NAE`,
    );
    expect(endpoints.eventsData('acc')).toBe(`${HOSTS.events}/api/v1/events/Fortnite/data/acc`);
  });

  it('repeats accountId for bulk lookups and enforces the limit', () => {
    const url = new URL(endpoints.accountsById(['a', 'b']));
    expect(url.searchParams.getAll('accountId')).toEqual(['a', 'b']);
    expect(() => endpoints.accountsById([])).toThrow(RangeError);
    expect(() => endpoints.accountsById(Array(BULK_ACCOUNT_LIMIT + 1).fill('x'))).toThrow(RangeError);
    expect(new URL(endpoints.accountsByIdUnchecked(Array(101).fill('x'))).searchParams.getAll('accountId')).toHaveLength(101);
  });

  it('builds history and tokens URLs', () => {
    expect(endpoints.playerWindowHistory('e', 'w', 'a')).toBe(`${HOSTS.events}/api/v1/events/Fortnite/e/w/history/a`);
    expect(endpoints.playerTokens(['a', 'b'])).toBe(`${HOSTS.events}/api/v1/players/Fortnite/tokens?teamAccountIds=a%2Cb`);
  });
});

describe('chunk', () => {
  it('splits into groups of at most n', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});
