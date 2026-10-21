// SYNTHETIC replay events, built to the byte layouts the open-source
// replay-reader documents, so the parsing and the route can be tested without
// a real replay. They make no claim about this season's replays; real
// captures would go in test/fixtures/epic/.

/** A `playerElim` event: header bytes, eliminated, eliminator, weapon type, knocked flag. */
export function elimEvent(o: {
  eliminated: string | 'bot';
  eliminator: string | 'bot';
  knocked?: boolean;
  header?: number;
}): Uint8Array<ArrayBuffer> {
  const player = (id: string) => (id === 'bot' ? [3] : [17, 0, ...Buffer.from(id, 'hex')]);
  return Uint8Array.from([
    ...new Array<number>(o.header ?? 165).fill(0),
    ...player(o.eliminated),
    ...player(o.eliminator),
    7,
    o.knocked ? 1 : 0,
    0,
    0,
    0,
  ]);
}

/** An `AthenaMatchStats` event: four bytes, accuracy, then ten counts. */
export function statsEvent(s: {
  accuracy: number;
  assists?: number;
  eliminations: number;
  weaponDamage: number;
  otherDamage?: number;
  revives?: number;
  damageTaken: number;
  damageToStructures?: number;
  materialsGathered: number;
  materialsUsed?: number;
  distance?: number;
}): Uint8Array<ArrayBuffer> {
  const b = Buffer.alloc(48);
  b.writeFloatLE(s.accuracy, 4);
  [
    s.assists ?? 0,
    s.eliminations,
    s.weaponDamage,
    s.otherDamage ?? 0,
    s.revives ?? 0,
    s.damageTaken,
    s.damageToStructures ?? 0,
    s.materialsGathered,
    s.materialsUsed ?? 0,
    s.distance ?? 0,
  ].forEach((v, i) => b.writeUInt32LE(v, 8 + i * 4));
  return new Uint8Array(b);
}
