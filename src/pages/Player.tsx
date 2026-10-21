// /players/:accountId (F23): anyone's season, from the boards you've searched.
// The name comes from your follows, else from Epic.

import { useParams } from 'react-router';
import type { PlayerLookup } from '../../lib/types';
import { useApi } from '../api';
import { PlayerView } from '../components/PlayerView';
import { Empty, LoadState } from '../components/ui';
import { useFollows } from '../follows';

const isAccountId = (v: string) => /^[0-9a-f]{32}$/.test(v);

export default function Player() {
  const id = useParams().accountId ?? '';
  const follow = useFollows().find((f) => f.id === id);
  const lookup = useApi<PlayerLookup[]>(!follow && isAccountId(id) ? `/api/player?ids=${id}` : null, 3_600_000);
  if (!isAccountId(id))
    return (
      <div className="py-10">
        <Empty>That isn't an Epic account ID.</Empty>
      </div>
    );
  const name = follow?.name ?? lookup.data?.[0]?.displayName;
  if (!name)
    return lookup.data ? (
      <div className="py-10">
        <Empty>Epic has no account with that ID.</Empty>
      </div>
    ) : (
      <LoadState loading={lookup.loading} error={lookup.error} onRetry={lookup.reload} rows={3} />
    );
  return <PlayerView key={id} id={id} name={name} isMe={follow?.isMe} />;
}
