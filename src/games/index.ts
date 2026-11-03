// Реестр мини-игр: открыть игру по id (в том числе в режиме мероприятия на карте).
import type { GameId } from '../config/minigames';
import type { App } from '../ui/app';
import type { PlayCtx } from './kit';
import { openFever } from './fever';
import { openRing } from './law';
import { openRunner } from './runner';
import { openStamp } from './stamp';
import { openAlias } from './party';
import { openWordle } from './wordle';
import { openBus } from './bus';
import { openBlocks } from './blocks';
import { openMerge } from './merge';
import { openCrossword } from './crossword';
import { openCategories } from './categories';

const OPEN: Record<GameId, (app: App, ctx?: PlayCtx) => void> = {
  fever: openFever, ring: openRing, runner: openRunner, stamp: openStamp, alias: openAlias,
  wordle: openWordle, bus: openBus, blocks: openBlocks, merge: openMerge, crossword: openCrossword, categories: openCategories,
};

export function openGame(app: App, id: GameId, ctx?: PlayCtx) {
  OPEN[id](app, ctx);
}
