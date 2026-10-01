import {
  pokeReaction,
  pokeRunMs,
  wakeReaction,
  type CharacterExpression,
  type CharacterMood,
} from '@edi/contracts';

interface MoodPort {
  readonly current: CharacterMood;
  set(mood: CharacterMood, holdMs?: number): void;
  noteActivity(): void;
}

/**
 * Edi's patience with being poked. Every poke counts as interaction (it wakes a sleepy Edi),
 * but a face only changes while Edi is free: never over a conversation, a reply's mood or an
 * error. Its own reactions can be escalated; anything else holding the face is left alone.
 */
export class PetPokes {
  private times: number[] = [];
  private reaction?: CharacterMood;

  constructor(
    private readonly expression: () => CharacterExpression,
    private readonly mood: MoodPort,
    private readonly now: () => number = Date.now,
  ) {}

  poke() {
    const now = this.now();
    this.times = this.times.filter(time => now - time < pokeRunMs);
    if (!this.times.length) this.reaction = undefined;
    this.times.push(now);

    const wasSleepy = this.mood.current === 'sleepy';
    this.mood.noteActivity();
    if (this.expression() !== 'idle') return;
    const current = this.mood.current;
    if (current !== 'neutral' && current !== this.reaction) return;

    const reaction = wasSleepy ? wakeReaction : pokeReaction(this.times.length);
    if (!reaction) return;
    this.reaction = reaction.mood;
    this.mood.set(reaction.mood, reaction.holdMs);
  }
}
