// Your own season (F25): the player page for the follow marked as you, with
// Sync with Epic to fill it (D30).

import { Link } from 'react-router';
import { PlayerView } from '../components/PlayerView';
import { SyncPanel } from '../components/SyncPanel';
import { Empty } from '../components/ui';
import { useFollows } from '../follows';

export default function Me() {
  const me = useFollows().find((f) => f.isMe);
  if (!me)
    return (
      <div className="space-y-4 py-6">
        <SyncPanel intro />
        <Empty
          action={
            <Link to="/follows" className="font-semibold text-accent-bright hover:underline">
              Go to Follows
            </Link>
          }
        >
          Or follow yourself and mark the follow as you, then check sessions by hand.
        </Empty>
      </div>
    );
  return <PlayerView key={me.id} id={me.id} name={me.name} isMe />;
}
