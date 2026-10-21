// Your own season (F25): the player page for the follow marked as you.

import { Link } from 'react-router';
import { PlayerView } from '../components/PlayerView';
import { Empty } from '../components/ui';
import { useFollows } from '../follows';

export default function Me() {
  const me = useFollows().find((f) => f.isMe);
  if (!me)
    return (
      <div className="py-10">
        <Empty
          action={
            <Link to="/follows" className="font-semibold text-accent-bright hover:underline">
              Go to Follows
            </Link>
          }
        >
          Follow yourself and mark the follow as you to see your results here.
        </Empty>
      </div>
    );
  return <PlayerView key={me.id} id={me.id} name={me.name} isMe />;
}
