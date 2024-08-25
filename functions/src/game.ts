import * as admin from "firebase-admin";

interface GameEvent {
  time: number;
  user: string;
  c1: string;
  c2: string;
  c3: string;
  c4?: string;
}

export type GameMode = "normal" | "setchain" | "ultraset";

/** Generates a random 81-card deck using a Fisher-Yates shuffle. */
export function generateDeck() {
  const deck: Array<string> = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        for (let l = 0; l < 3; l++) {
          deck.push(`${i}${j}${k}${l}`);
        }
      }
    }
  }
  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }
  return deck;
}

/** Check if three cards form a set. */
export function checkSet(a: string, b: string, c: string) {
  for (let i = 0; i < 4; i++) {
    if ((a.charCodeAt(i) + b.charCodeAt(i) + c.charCodeAt(i)) % 3 !== 0)
      return false;
  }
  return true;
}

/** Returns the unique card c such that {a, b, c} form a set. */
function conjugateCard(a: string, b: string) {
  const zeroCode = "0".charCodeAt(0);
  let c = "";
  for (let i = 0; i < 4; i++) {
    const sum = a.charCodeAt(i) - zeroCode + b.charCodeAt(i) - zeroCode;
    const lastNum = (3 - (sum % 3)) % 3;
    c += String.fromCharCode(zeroCode + lastNum);
  }
  return c;
}

/** Check if four cards form an ultraset */
export function checkSetUltra(a: string, b: string, c: string, d: string) {
  if (conjugateCard(a, b) === conjugateCard(c, d)) return [a, b, c, d];
  if (conjugateCard(a, c) === conjugateCard(b, d)) return [a, c, b, d];
  if (conjugateCard(a, d) === conjugateCard(b, c)) return [a, d, b, c];
  return null;
}

/** Check if six cards form a hyperset. The order irrelevant, because if one set of pairs work, all the other possible sets of pairs of the same 6 cards work as well.*/
export function checkSetHyper(a: string, b: string, c: string, d:string, e: string, f: string) {
  return checkSet(conjugateCard(a, b), conjugateCard(c, d), conjugateCard(e, f));
}

/** Find a set in an unordered collection of cards, if any, depending on mode. */
export function findSet(deck: string[], gameMode: GameMode, old?: string[]) {
  const deckSet = new Set(deck);
  const ultraConjugates: Record<string, [string, string]> = {};
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const c = conjugateCard(deck[i], deck[j]);
      if (
        gameMode === "normal" ||
        (gameMode === "setchain" && old!.length === 0)
      ) {
        if (deckSet.has(c)) {
          return [deck[i], deck[j], c];
        }
      } else if (gameMode === "setchain") {
        if (old!.includes(c)) {
          return [c, deck[i], deck[j]];
        }
      } else if (gameMode === "ultraset") {
        if (c in ultraConjugates) {
          return [...ultraConjugates[c], deck[i], deck[j]];
        }
        ultraConjugates[c] = [deck[i], deck[j]];
      } else if (gameMode === "hyperset") {
      	for (let k = j + 1; k < deck.length; k++) {
      	  for (let l = k + 1; l < deck.length; l++) {
      	    for (let m = l + 1; m < deck.length; m++) {
              for (let n = m + 1; n < deck.length; n++) {
                if (checkSetHyper(deck[i], deck[j], deck[k], deck[l], deck[m], deck[n])) 
                  return [deck[i], deck[j], deck[k], deck[l], deck[m], deck[n]];
              }
      	    }
      	  }
      	}
      }
    }
  }
  return null;
}

/** Check if cards are valid (all distinct and exist in deck) */
function isValid(deck: Set<string>, cards: string[]) {
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i] === cards[j]) return false;
    }
    if (!deck.has(cards[i])) return false;
  }
  return true;
}

/** Delete cards from deck */
function deleteCards(deck: Set<string>, cards: string[]) {
  for (const c of cards) deck.delete(c);
}

/** Replay game event for normal mode */
function replayEventNormal(deck: Set<string>, event: GameEvent) {
  const cards = [event.c1, event.c2, event.c3];
  if (!isValid(deck, cards)) return false;
  deleteCards(deck, cards);
  return true;
}

/** Replay game event for setchain mode */
function replayEventChain(
  history: GameEvent[],
  deck: Set<string>,
  event: GameEvent
) {
  const { c1, c2, c3 } = event;

  // Check validity
  let ok = c1 !== c2 && c2 !== c3 && c1 !== c3;
  ok &&= deck.has(c2) && deck.has(c3);
  if (history.length) {
    // One card (c1) should be taken from the previous set
    const prevEvent = history[history.length - 1];
    const prev = [prevEvent.c1, prevEvent.c2, prevEvent.c3];
    ok &&= prev.includes(c1);
  }
  if (!ok) return;

  const cards = history.length === 0 ? [c1, c2, c3] : [c2, c3];
  deleteCards(deck, cards);
  return true;
}

/** Replay game event for ultraset mode */
function replayEventUltra(deck: Set<string>, event: GameEvent) {
  const cards = [event.c1, event.c2, event.c3, event.c4!];
  if (!isValid(deck, cards)) return false;
  deleteCards(deck, cards);
  return true;
}

/** Replay game event for hyperset mode */
function replayEventHyper(deck: Set<string>, event: GameEvent) {
  const cards = [event.c1, event.c2, event.c3, event.c4, event.c5, event.c6];
  if (!isValid(deck, cards)) return false;
  deleteCards(deck, cards);
  return true;
}

/**
 * Compute remaining cards (arbitrary order) left in the deck after some
 * events, as well as the time of the final valid event.
 */
export function replayEvents(
  gameData: admin.database.DataSnapshot,
  gameMode: GameMode
) {
  const events: GameEvent[] = [];
  gameData.child("events").forEach((e) => {
    events.push(e.val());
  });
  // Array.sort() is guaranteed to be stable in Node.js, and the latest ES spec
  events.sort((e1, e2) => e1.time - e2.time);

  const deck: Set<string> = new Set(gameData.child("deck").val());
  const history: GameEvent[] = [];
  const scores: Record<string, number> = {};
  let finalTime = 0;
  for (const event of events) {
    let eventValid = false;
    if (gameMode === "normal" && replayEventNormal(deck, event))
      eventValid = true;
    if (gameMode === "setchain" && replayEventChain(history, deck, event))
      eventValid = true;
    if (gameMode === "ultraset" && replayEventUltra(deck, event))
      eventValid = true;
    if (gameMode === "hyperset" && replayEventHyper(deck, event))
      eventValid = true;
    if (eventValid) {
      history.push(event);
      scores[event.user] = (scores[event.user] ?? 0) + 1;
      finalTime = event.time;
    }
  }

  let lastSet: string[] = [];
  if (gameMode === "setchain" && history.length > 0) {
    const lastEvent = history[history.length - 1];
    lastSet = [lastEvent.c1, lastEvent.c2, lastEvent.c3];
  }

  return { lastSet, deck, finalTime, scores };
}
