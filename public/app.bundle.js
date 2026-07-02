(() => {
'use strict';

/* src/random.js */
function hashSeed(input) {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function createRng(seed) {
  let a = hashSeed(seed);
  return function rng() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}


/* src/hangul.js */
const COMPLETE_HANGUL = /^[가-힣]+$/u;
const JAMO = /[ㄱ-ㅎㅏ-ㅣ]/u;
const STRIP_CHARS = /[\s\-‐‑‒–—―·ㆍ.,:;!?()[\]{}<>"'“”‘’`~@#$%^&*_+=|\\/0-9０-９①-⑳㉠-㉿Ⅰ-Ⅻ]+/gu;

function toSyllables(word) {
  return [...word];
}

function cleanWord(rawWord) {
  if (typeof rawWord !== 'string' || rawWord.length === 0) return null;
  if (JAMO.test(rawWord)) return null;

  const clean = rawWord.replace(STRIP_CHARS, '');
  if (!COMPLETE_HANGUL.test(clean)) return null;

  const syllables = toSyllables(clean);
  if (syllables.length < 2) return null;
  if (new Set(syllables).size !== syllables.length) return null;

  return clean;
}

function hasFinalConsonant(syllable) {
  const code = syllable.codePointAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function topicParticle(word) {
  const syllables = toSyllables(word);
  const last = syllables[syllables.length - 1];
  return hasFinalConsonant(last) ? '은' : '는';
}

function withTopicParticle(word) {
  return `${word}${topicParticle(word)}`;
}

function hasTenseOrAspirated(word) {
  const rareInitials = new Set([1, 4, 8, 10, 13, 14, 15, 16, 17]);
  return toSyllables(word).some((syllable) => {
    const code = syllable.codePointAt(0);
    if (code < 0xac00 || code > 0xd7a3) return false;
    const initial = Math.floor((code - 0xac00) / 588);
    return rareInitials.has(initial);
  });
}


/* src/puzzle.js */

const BOARD_SIZE = 5;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const MIN_PLAYABLE_ANSWERS = 20;
const SEED_WORD_BATCH_SIZE = 10;
const SEED_WORD_BATCH_COUNT = 3;
const SEED_WORD_COUNT = SEED_WORD_BATCH_SIZE * SEED_WORD_BATCH_COUNT;
const MIN_COMPLETED_SEED_WORDS = MIN_PLAYABLE_ANSWERS;
const GOAL_COUNT = 10;
const MIN_ANSWER_SYLLABLES = 3;
const MAX_ANSWER_SYLLABLES = 6;
const MIN_CORE_LONG_ANSWERS = 3;
const MIN_FIRST_SEED_LONG_WORDS = 4;
const GENERATOR_VERSION = 'malitmot-hourly-v9';

const MIXED_LENGTH_PATTERN = [3, 4, 3, 5, 3, 4, 3, 6, 4, 5];

const NEIGHBORS = Array.from({ length: BOARD_CELLS }, (_, index) => {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  const neighbors = [];

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow >= 0 && nextRow < BOARD_SIZE && nextCol >= 0 && nextCol < BOARD_SIZE) {
        neighbors.push(nextRow * BOARD_SIZE + nextCol);
      }
    }
  }

  return neighbors;
});

function normalizeCandidates(rawWords, options = {}) {
  const maxLength = options.maxLength ?? BOARD_CELLS;
  const minLength = options.minLength ?? 2;
  const unique = new Set();

  for (const raw of rawWords) {
    const clean = cleanWord(raw);
    if (!clean) continue;
    const length = toSyllables(clean).length;
    if (length < minLength || length > maxLength) continue;
    unique.add(clean);
  }

  return [...unique];
}

function candidateEntries(words) {
  const freq = new Map();
  for (const word of words) {
    for (const syllable of toSyllables(word)) {
      freq.set(syllable, (freq.get(syllable) ?? 0) + 1);
    }
  }

  return words
    .map((word) => {
      const syllables = toSyllables(word);
      const frequencyScore = syllables.reduce((sum, syllable) => sum + (freq.get(syllable) ?? 0), 0);
      return { word, syllables, frequencyScore };
    })
    .sort((a, b) => b.frequencyScore - a.frequencyScore || a.word.localeCompare(b.word, 'ko'));
}

function kstHourSeed(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const hour = String(kst.getUTCHours()).padStart(2, '0');
  return `${year}${month}${day}${hour}`;
}

function secondsUntilNextHour(date = new Date()) {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return Math.max(0, Math.ceil((next.getTime() - date.getTime()) / 1000));
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return [minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function filledSyllables(board) {
  return board.filter(Boolean);
}

function addCost(board, entry) {
  const syllables = new Set(filledSyllables(board));
  let cost = 0;
  for (const syllable of entry.syllables) {
    if (!syllables.has(syllable)) {
      syllables.add(syllable);
      cost += 1;
    }
  }
  return { cost, total: syllables.size };
}

function entryLength(entry) {
  return entry.syllables.length;
}

function syllableSet(entries) {
  const syllables = new Set();
  for (const entry of entries) {
    for (const syllable of entry.syllables) {
      syllables.add(syllable);
    }
  }
  return syllables;
}

function overlapCount(entry, syllables) {
  if (!syllables) return 0;
  return entry.syllables.reduce((count, syllable) => count + (syllables.has(syllable) ? 1 : 0), 0);
}

function seedAffinity(seedWords) {
  if (seedWords.length < SEED_WORD_BATCH_SIZE) return null;
  const sourceCount = seedWords.length < SEED_WORD_BATCH_SIZE * 2
    ? SEED_WORD_BATCH_SIZE
    : SEED_WORD_BATCH_SIZE * 2;
  return syllableSet(seedWords.slice(0, sourceCount));
}

function firstSeedLongCount(seedWords) {
  return seedWords
    .slice(0, SEED_WORD_BATCH_SIZE)
    .filter((entry) => entryLength(entry) >= 4)
    .length;
}

function seedPickOptions(seedWords) {
  const preferredLength = MIXED_LENGTH_PATTERN[seedWords.length % MIXED_LENGTH_PATTERN.length];
  if (seedWords.length >= SEED_WORD_BATCH_SIZE) return { preferredLength };

  const remainingSlots = SEED_WORD_BATCH_SIZE - seedWords.length;
  const remainingLongWords = MIN_FIRST_SEED_LONG_WORDS - firstSeedLongCount(seedWords);
  const shouldForceLong = remainingLongWords > 0
    && (preferredLength >= 4 || remainingLongWords >= remainingSlots);

  return {
    preferredLength,
    minLength: shouldForceLong ? 4 : null,
  };
}

function pickSeedWord(board, baseOrder, seedWords, usedWords, rng, options = {}) {
  const affinity = seedAffinity(seedWords);
  const preferredLength = options.preferredLength ?? MIXED_LENGTH_PATTERN[seedWords.length % MIXED_LENGTH_PATTERN.length];
  const minLength = options.minLength ?? null;
  const choices = [];
  const offset = Math.floor(rng() * baseOrder.length);
  const maxChoices = seedWords.length < SEED_WORD_BATCH_SIZE ? 900 : 360;

  for (let count = 0; count < baseOrder.length; count += 1) {
    const entry = baseOrder[(offset + count) % baseOrder.length];
    if (usedWords.has(entry.word)) continue;
    if (minLength && entryLength(entry) < minLength) continue;

    const overlap = overlapCount(entry, affinity);
    if (affinity && overlap === 0) continue;

    const { cost, total } = addCost(board, entry);
    if (total > BOARD_CELLS) continue;
    if (cost > 5 && seedWords.length > 4) continue;

    const placed = placeWord(board, entry, rng);
    if (!placed) continue;

    choices.push({ entry, placed, cost, overlap });
    if (choices.length >= maxChoices) break;
  }

  if (choices.length === 0) return null;

  choices.sort((a, b) => {
    const aLengthMatch = entryLength(a.entry) === preferredLength ? 0 : 1;
    const bLengthMatch = entryLength(b.entry) === preferredLength ? 0 : 1;
    return aLengthMatch - bLengthMatch
      || a.cost - b.cost
      || b.overlap - a.overlap
      || b.entry.frequencyScore - a.entry.frequencyScore
      || a.entry.word.localeCompare(b.entry.word, 'ko');
  });

  const window = choices.slice(0, Math.min(18, choices.length));
  return window[Math.floor(rng() * window.length)];
}

function pickPlayableSeedWord(board, baseOrder, seedWords, usedWords, rng, options = {}) {
  const requireAffinity = options.requireAffinity ?? true;
  const affinity = seedAffinity(seedWords);
  const preferredLength = MIXED_LENGTH_PATTERN[seedWords.length % MIXED_LENGTH_PATTERN.length];
  const boardSyllables = new Set(board);
  const choices = [];
  const offset = Math.floor(rng() * baseOrder.length);
  const maxChoices = seedWords.length < SEED_WORD_BATCH_SIZE ? 900 : 360;

  for (let count = 0; count < baseOrder.length; count += 1) {
    const entry = baseOrder[(offset + count) % baseOrder.length];
    if (usedWords.has(entry.word)) continue;

    const overlap = overlapCount(entry, affinity);
    if (requireAffinity && affinity && overlap === 0) continue;
    if (!entry.syllables.every((syllable) => boardSyllables.has(syllable))) continue;

    const path = findPath(board, entry.word);
    if (!path) continue;

    choices.push({ entry, path, overlap });
    if (choices.length >= maxChoices) break;
  }

  if (choices.length === 0) return null;

  choices.sort((a, b) => {
    const aLengthMatch = entryLength(a.entry) === preferredLength ? 0 : 1;
    const bLengthMatch = entryLength(b.entry) === preferredLength ? 0 : 1;
    return aLengthMatch - bLengthMatch
      || b.overlap - a.overlap
      || b.entry.frequencyScore - a.entry.frequencyScore
      || a.entry.word.localeCompare(b.entry.word, 'ko');
  });

  const window = choices.slice(0, Math.min(18, choices.length));
  return window[Math.floor(rng() * window.length)];
}

function completeSeedWordsFromBoard(board, baseOrder, baseCoreOrder, seedWords, usedWords, rng, stats) {
  while (seedWords.length < SEED_WORD_COUNT) {
    const seedPool = seedWords.length < SEED_WORD_BATCH_SIZE ? baseCoreOrder : baseOrder;
    let pick = pickPlayableSeedWord(board, seedPool, seedWords, usedWords, rng);
    if (!pick) {
      pick = pickPlayableSeedWord(board, seedPool, seedWords, usedWords, rng, { requireAffinity: false });
      if (pick && stats) stats.relaxedSeedCompletions = (stats.relaxedSeedCompletions ?? 0) + 1;
    }
    if (!pick) break;
    seedWords.push(pick.entry);
    usedWords.add(pick.entry.word);
  }

  return seedWords.length === SEED_WORD_COUNT;
}

function completeSeedWordsFromAnswers(seedWords, usedWords, playableAnswers) {
  for (const entry of playableAnswers) {
    if (seedWords.length >= SEED_WORD_COUNT) break;
    if (usedWords.has(entry.word)) continue;
    seedWords.push(entry);
    usedWords.add(entry.word);
  }

  return seedWords.length === SEED_WORD_COUNT;
}

function placeWord(board, entry, rng = Math.random) {
  const fixed = new Map();
  board.forEach((syllable, index) => {
    if (syllable) fixed.set(syllable, index);
  });

  const cellOrder = shuffle([...Array(BOARD_CELLS).keys()], rng);

  function visit(step, workingBoard, path) {
    const syllable = entry.syllables[step];
    let cells = fixed.has(syllable) ? [fixed.get(syllable)] : cellOrder.filter((index) => !workingBoard[index]);

    if (step > 0) {
      cells = cells.filter((index) => NEIGHBORS[path[step - 1]].includes(index));
    }

    cells = cells.filter((index) => !path.includes(index));

    for (const cell of cells) {
      const nextBoard = [...workingBoard];
      if (nextBoard[cell] && nextBoard[cell] !== syllable) continue;
      if (!nextBoard[cell]) nextBoard[cell] = syllable;

      const nextPath = [...path, cell];
      if (step === entry.syllables.length - 1) {
        return { board: nextBoard, path: nextPath };
      }

      const placed = visit(step + 1, nextBoard, nextPath);
      if (placed) return placed;
    }

    return null;
  }

  return visit(0, [...board], []);
}

function findPath(board, word) {
  const syllables = toSyllables(word);

  function visit(step, cell, used, path) {
    if (board[cell] !== syllables[step]) return null;
    if (step === syllables.length - 1) return path;

    for (const next of NEIGHBORS[cell]) {
      if (used.has(next)) continue;
      used.add(next);
      const found = visit(step + 1, next, used, [...path, next]);
      if (found) return found;
      used.delete(next);
    }

    return null;
  }

  for (let cell = 0; cell < board.length; cell += 1) {
    if (board[cell] !== syllables[0]) continue;
    const found = visit(0, cell, new Set([cell]), [cell]);
    if (found) return found;
  }

  return null;
}

function findPlayableAnswers(entriesOrWords, board) {
  const entries = typeof entriesOrWords[0] === 'string' ? candidateEntries(entriesOrWords) : entriesOrWords;
  const boardSyllables = new Set(board);
  const playable = [];

  for (const entry of entries) {
    if (entry.syllables.length > board.length) continue;
    if (!entry.syllables.every((syllable) => boardSyllables.has(syllable))) continue;
    if (!findPath(board, entry.word)) continue;
    playable.push(entry);
  }

  return playable
    .sort((a, b) => a.word.localeCompare(b.word, 'ko'));
}

function pickFallbackLength(groups, previousLength) {
  const available = [...groups.entries()]
    .filter(([, entries]) => entries.length > 0)
    .map(([length, entries]) => ({ length, count: entries.length }));
  if (available.length === 0) return null;

  const nonRepeating = available.filter((group) => group.length !== previousLength);
  const candidates = nonRepeating.length > 0 ? nonRepeating : available;
  candidates.sort((a, b) => b.count - a.count || a.length - b.length);
  return candidates[0].length;
}

function orderPlayableAnswers(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const length = entryLength(entry);
    if (!groups.has(length)) groups.set(length, []);
    groups.get(length).push(entry);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.word.localeCompare(b.word, 'ko'));
  }

  const ordered = [];
  let previousLength = null;

  while (ordered.length < entries.length) {
    let moved = false;

    for (const preferredLength of MIXED_LENGTH_PATTERN) {
      let length = preferredLength;
      if (!groups.get(length)?.length) {
        length = pickFallbackLength(groups, previousLength);
      }
      if (length === null) break;

      const entry = groups.get(length).shift();
      ordered.push(entry);
      previousLength = length;
      moved = true;

      if (ordered.length === entries.length) break;
    }

    if (!moved) break;
  }

  return ordered;
}

function hasMixedCoreAnswers(entries) {
  if (entries.length < GOAL_COUNT) return false;
  const longAnswerCount = entries.filter((entry) => entryLength(entry) >= 4).length;
  if (longAnswerCount < MIN_CORE_LONG_ANSWERS) return false;

  const core = entries.slice(0, GOAL_COUNT);
  const coreLongAnswerCount = core.filter((entry) => entryLength(entry) >= 4).length;
  return coreLongAnswerCount >= MIN_CORE_LONG_ANSWERS;
}

function hasLongFirstSeedBatch(seedWords) {
  if (seedWords.length < SEED_WORD_BATCH_SIZE) return false;
  const firstSeedBatch = seedWords.slice(0, SEED_WORD_BATCH_SIZE);
  return firstSeedBatch.filter((entry) => entryLength(entry) >= 4).length >= MIN_FIRST_SEED_LONG_WORDS;
}

function entriesFromCandidates(candidates) {
  if (!candidates) return [];
  if (candidates.length === 0) return [];
  return typeof candidates[0] === 'string' ? candidateEntries(candidates) : candidates;
}

function answerMeta(word, index, group = 'board') {
  const syllables = toSyllables(word);
  const tags = [];
  if (syllables.some(hasFinalConsonant)) tags.push('받침');
  if (hasTenseOrAspirated(word)) tags.push('희귀자음');
  if (syllables.length >= 5) tags.push('긴 단어');

  return {
    word,
    order: index,
    type: index < GOAL_COUNT ? 'core' : 'bonus',
    group,
    syllableCount: syllables.length,
    tags,
  };
}

function fillBoard(board, entries, rng) {
  const syllables = [];
  const seen = new Set();

  for (const entry of entries) {
    for (const syllable of entry.syllables) {
      if (!seen.has(syllable)) {
        seen.add(syllable);
        syllables.push(syllable);
      }
    }
  }

  for (const syllable of shuffle(syllables, rng)) {
    if (board.every(Boolean)) break;
    if (board.includes(syllable)) continue;
    board[board.indexOf(null)] = syllable;
  }

  if (board.some((cell) => !cell)) {
    throw new Error(`보드 ${BOARD_CELLS}칸을 채울 음절 후보가 부족합니다.`);
  }

  return board;
}

function generatePuzzle(candidates, seed, options = {}) {
  const entries = Array.isArray(candidates[0]) || typeof candidates[0] === 'string'
    ? candidateEntries(candidates)
    : candidates;
  const answerEntries = options.answerCandidates
    ? entriesFromCandidates(options.answerCandidates)
    : entries;
  const bonusAnswerEntries = entriesFromCandidates(options.bonusAnswerCandidates);
  const coreEntries = options.coreCandidates
    ? (typeof options.coreCandidates[0] === 'string' ? candidateEntries(options.coreCandidates) : options.coreCandidates)
    : entries;
  const placementLimit = options.placementLimit ?? entries.length;
  const stats = options.stats;
  const placementPool = entries
    .slice(0, placementLimit)
    .filter((entry) => entry.syllables.length >= MIN_ANSWER_SYLLABLES && entry.syllables.length <= MAX_ANSWER_SYLLABLES);
  const corePlacementPool = coreEntries
    .slice(0, placementLimit)
    .filter((entry) => entry.syllables.length >= MIN_ANSWER_SYLLABLES && entry.syllables.length <= MAX_ANSWER_SYLLABLES);
  const syllablePool = entries.filter((entry) => entry.syllables.length <= BOARD_CELLS);
  const minPlayableAnswers = options.minPlayableAnswers ?? MIN_PLAYABLE_ANSWERS;
  const minSeedWords = options.minSeedWords ?? Math.min(SEED_WORD_COUNT, MIN_COMPLETED_SEED_WORDS, minPlayableAnswers);
  const maxAttempts = options.maxAttempts ?? 300;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (stats) stats.attempts = (stats.attempts ?? 0) + 1;
    const rng = createRng(`${seed}:${GENERATOR_VERSION}:${attempt}`);
    const baseCoreOrder = shuffle(corePlacementPool, rng);
    const baseOrder = shuffle(placementPool, rng);
    let board = Array(BOARD_CELLS).fill(null);
    const seedWords = [];
    const usedWords = new Set();

    while (seedWords.length < SEED_WORD_COUNT) {
      const seedPool = seedWords.length < SEED_WORD_BATCH_SIZE ? baseCoreOrder : baseOrder;
      const pick = pickSeedWord(board, seedPool, seedWords, usedWords, rng, seedPickOptions(seedWords));
      if (!pick) break;

      board = pick.placed.board;
      seedWords.push(pick.entry);
      usedWords.add(pick.entry.word);
    }

    let boardFilled = false;
    if (seedWords.length !== SEED_WORD_COUNT && seedWords.length >= Math.ceil(SEED_WORD_BATCH_SIZE / 2)) {
      board = fillBoard(board, syllablePool, rng);
      boardFilled = true;
      completeSeedWordsFromBoard(board, baseOrder, baseCoreOrder, seedWords, usedWords, rng, stats);
    }

    if (seedWords.length < SEED_WORD_BATCH_SIZE) {
      if (stats) {
        stats.seedFailures = (stats.seedFailures ?? 0) + 1;
        stats.maxSeedWords = Math.max(stats.maxSeedWords ?? 0, seedWords.length);
        stats.failedSeedLengths ??= [];
        stats.failedSeedLengths.push(seedWords.length);
      }
      continue;
    }

    if (!boardFilled) board = fillBoard(board, syllablePool, rng);
    const playableBoardAnswers = orderPlayableAnswers(
      findPlayableAnswers(answerEntries, board)
        .filter((entry) => entry.syllables.length >= MIN_ANSWER_SYLLABLES && entry.syllables.length <= MAX_ANSWER_SYLLABLES),
    );
    completeSeedWordsFromAnswers(seedWords, usedWords, playableBoardAnswers);
    if (stats) {
      stats.completedSeeds = (stats.completedSeeds ?? 0) + 1;
      stats.maxPlayableAnswers = Math.max(stats.maxPlayableAnswers ?? 0, playableBoardAnswers.length);
    }

    const hasUniqueBoard = new Set(board).size === BOARD_CELLS;
    const hasCompleteSeeds = seedWords.length >= minSeedWords;
    const hasLongSeeds = hasLongFirstSeedBatch(seedWords);
    const hasEnoughBoardAnswers = playableBoardAnswers.length >= minPlayableAnswers;
    const hasMixedAnswers = hasMixedCoreAnswers(playableBoardAnswers);

    if (stats) {
      if (!hasUniqueBoard) stats.uniqueBoardFailures = (stats.uniqueBoardFailures ?? 0) + 1;
      if (!hasCompleteSeeds) stats.completeSeedFailures = (stats.completeSeedFailures ?? 0) + 1;
      if (!hasLongSeeds) stats.longSeedFailures = (stats.longSeedFailures ?? 0) + 1;
      if (!hasEnoughBoardAnswers) stats.playableAnswerFailures = (stats.playableAnswerFailures ?? 0) + 1;
      if (!hasMixedAnswers) stats.mixedAnswerFailures = (stats.mixedAnswerFailures ?? 0) + 1;
    }

    if (
      hasUniqueBoard
      && hasCompleteSeeds
      && hasLongSeeds
      && hasEnoughBoardAnswers
      && hasMixedAnswers
    ) {
      const boardAnswerWords = new Set(playableBoardAnswers.map((entry) => entry.word));
      const playableBonusAnswers = orderPlayableAnswers(
        findPlayableAnswers(bonusAnswerEntries, board)
          .filter((entry) => entry.syllables.length >= MIN_ANSWER_SYLLABLES && entry.syllables.length <= MAX_ANSWER_SYLLABLES)
          .filter((entry) => !boardAnswerWords.has(entry.word)),
      );
      if (stats) {
        stats.maxBonusPlayableAnswers = Math.max(stats.maxBonusPlayableAnswers ?? 0, playableBonusAnswers.length);
      }

      const answerSheet = [
        ...playableBoardAnswers.map((entry, index) => answerMeta(entry.word, index, 'board')),
        ...playableBonusAnswers.map((entry, index) => answerMeta(entry.word, playableBoardAnswers.length + index, 'bonus')),
      ];

      return {
        seed,
        generatorVersion: GENERATOR_VERSION,
        board,
        seedWords: seedWords.map((entry) => entry.word),
        answerSheet,
        goalCount: GOAL_COUNT,
        playableAnswerCount: answerSheet.length,
        playableBoardAnswerCount: playableBoardAnswers.length,
        playableBonusAnswerCount: playableBonusAnswers.length,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  throw new Error(`시간별 문제판을 생성하지 못했습니다: ${seed}`);
}


/* src/app.js */

const app = document.querySelector('#app');
const adBanner = document.querySelector('[data-ad-banner]');
const HELP_STORAGE_KEY = 'malitmot:help:v1:seen';
const SHARE_URL = 'https://plan9.kr/malitmot';
const CONFETTI_SCRIPT_URL = './public/vendor/canvas-confetti.browser.min.js?v=1.9.4';
const TILE_LOCK_INSET_RATIO = 0.14;
const MIN_TILE_LOCK_HITBOX_SIZE = 44;
let adBannerEnabled = false;
let confettiPromise = null;

const state = {
  candidates: [],
  entries: [],
  coreEntries: [],
  answerEntries: [],
  bonusAnswerEntries: [],
  puzzle: null,
  seed: '',
  pendingSeed: '',
  selectedPath: [],
  pointerActive: false,
  pointer: null,
  found: new Set(),
  feedback: '선을 이어 단어를 찾아보세요.',
  feedbackTone: 'idle',
  burst: null,
  toast: null,
  helpOpen: false,
  foundOpen: false,
};

function loadingTemplate(message = '게임 보드를 만드는 중') {
  return `
    <main class="shell loading-shell" aria-busy="true" aria-live="polite">
      <section class="loading-content">
        <h1>말잇못</h1>
        <p class="loading-message">${message}<span aria-hidden="true">···</span></p>
      </section>
    </main>
  `;
}

function nextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function enableAdBanner() {
  if (adBannerEnabled || !adBanner) return;

  const image = adBanner.querySelector('img[data-src]');
  if (!image) return;
  const source = image.dataset.src;
  if (!source) return;

  const showLoadedAd = () => {
    if (!image.naturalWidth) return;
    adBanner.hidden = false;
    adBannerEnabled = true;
  };

  image?.addEventListener('error', () => {
    adBanner.hidden = true;
  }, { once: true });
  image.addEventListener('load', showLoadedAd, { once: true });

  image.loading = 'eager';
  if (!image.hasAttribute('src')) {
    image.src = source;
  }

  if (image.complete) showLoadedAd();
}

function loadConfetti() {
  if (typeof globalThis.confetti === 'function') return Promise.resolve(globalThis.confetti);
  if (confettiPromise) return confettiPromise;

  confettiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CONFETTI_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (typeof globalThis.confetti === 'function') resolve(globalThis.confetti);
      else reject(new Error('confetti library did not load'));
    };
    script.onerror = () => reject(new Error('confetti library failed to load'));
    document.head.append(script);
  }).catch(() => null);

  return confettiPromise;
}

function goalConfettiOrigin() {
  const board = document.querySelector('.board-wrap');
  if (!board) return { x: 0.5, y: 0.45 };

  const rect = board.getBoundingClientRect();
  return {
    x: Math.min(0.9, Math.max(0.1, (rect.left + rect.width / 2) / window.innerWidth)),
    y: Math.min(0.82, Math.max(0.12, (rect.top + rect.height * 0.42) / window.innerHeight)),
  };
}

function launchGoalConfetti() {
  loadConfetti().then((confetti) => {
    if (!confetti) return;
    const origin = goalConfettiOrigin();
    const shared = {
      disableForReducedMotion: true,
      ticks: 180,
      scalar: 0.95,
      zIndex: 20,
    };

    confetti({ ...shared, particleCount: 80, spread: 68, startVelocity: 32, origin });
    window.setTimeout(() => {
      confetti({ ...shared, particleCount: 36, angle: 60, spread: 55, origin: { x: 0.12, y: origin.y } });
      confetti({ ...shared, particleCount: 36, angle: 120, spread: 55, origin: { x: 0.88, y: origin.y } });
    }, 140);
  });
}

async function loadCandidates() {
  const payload = globalThis.MALITMOT_WORDS_PAYLOAD;
  if (!payload?.words?.length) throw new Error('단어 후보를 불러오지 못했습니다.');
  return payload;
}

function storageKey(seed) {
  return `malitmot:${seed}:found`;
}

function loadFound(seed, answerWords) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(seed)) ?? '[]');
    return new Set(saved.filter((word) => answerWords.has(word)));
  } catch {
    return new Set();
  }
}

function saveFound() {
  if (!state.seed) return;
  localStorage.setItem(storageKey(state.seed), JSON.stringify([...state.found]));
}

function hasSeenHelp() {
  try {
    return localStorage.getItem(HELP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markHelpSeen() {
  try {
    localStorage.setItem(HELP_STORAGE_KEY, '1');
  } catch {
    // localStorage can be unavailable in some private or embedded browser contexts.
  }
}

function openHelp() {
  state.helpOpen = true;
  state.foundOpen = false;
  render();
}

function closeHelp() {
  state.helpOpen = false;
  markHelpSeen();
  render();
}

function openFound() {
  state.foundOpen = true;
  state.helpOpen = false;
  render();
}

function closeFound() {
  state.foundOpen = false;
  render();
}

function resultShareText() {
  return `말잇못 #${state.seed} ${foundCount()}개 찾음 ${SHARE_URL}`;
}

function shouldUseNativeShare() {
  const userAgent = navigator.userAgent ?? '';
  const isiPadDesktopMode = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
  return typeof navigator.share === 'function'
    && (/Android|iPhone|iPad|iPod/i.test(userAgent) || isiPadDesktopMode);
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('clipboard copy failed');
}

async function copyShareText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  fallbackCopy(text);
}

function showToast(message) {
  const id = Date.now();
  state.toast = { id, message };
  render();
  window.setTimeout(() => {
    if (state.toast?.id !== id) return;
    state.toast = null;
    document.querySelector('.toast')?.remove();
  }, 1900);
}

function vibrate(pattern) {
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Unsupported or blocked haptics should never interrupt play.
  }
}

function playSuccessHaptic(isBonus) {
  vibrate(isBonus ? [55, 45, 70] : 55);
}

async function shareResult() {
  const text = resultShareText();

  if (shouldUseNativeShare()) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }

  try {
    await copyShareText(text);
    showToast('결과를 클립보드에 복사했어요.');
  } catch {
    showToast('복사하지 못했어요. 다시 시도해 주세요.');
  }
}

function startCurrentPuzzle() {
  const seed = kstHourSeed(new Date());
  if (state.puzzle && state.seed === seed) return;

  state.seed = seed;
  state.pendingSeed = '';
  state.puzzle = generatePuzzle(state.entries, seed, {
    answerCandidates: state.answerEntries,
    bonusAnswerCandidates: state.bonusAnswerEntries,
    coreCandidates: state.coreEntries,
  });
  state.selectedPath = [];
  state.pointerActive = false;
  state.pointer = null;
  state.foundOpen = false;
  state.feedback = '선을 이어 단어를 찾아보세요.';
  state.feedbackTone = 'idle';
  const answerWords = new Set(state.puzzle.answerSheet.map((answer) => answer.word));
  state.found = loadFound(seed, answerWords);
  render();
}

function answerMap() {
  return new Map(state.puzzle.answerSheet.map((answer) => [answer.word, answer]));
}

function foundCount() {
  return state.found.size;
}

function bonusCount() {
  return Math.max(0, foundCount() - GOAL_COUNT);
}

function progressCount() {
  return Math.min(foundCount(), GOAL_COUNT);
}

function currentWord() {
  return state.selectedPath.map((index) => state.puzzle.board[index]).join('');
}

function selectionAnchor(path = state.selectedPath) {
  const board = document.querySelector('.board');
  if (!board || path.length === 0) return { x: 50, y: 50 };

  const boardRect = board.getBoundingClientRect();
  const points = path
    .map((index) => document.querySelector(`[data-cell="${index}"]`))
    .filter(Boolean)
    .map((tile) => {
      const rect = tile.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - boardRect.left,
        y: rect.top + rect.height / 2 - boardRect.top,
      };
    });

  if (points.length === 0) return { x: 50, y: 50 };

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;

  return {
    x: Math.min(92, Math.max(8, (x / boardRect.width) * 100)),
    y: Math.min(92, Math.max(8, (y / boardRect.height) * 100)),
  };
}

function isAdjacent(a, b) {
  const ar = Math.floor(a / BOARD_SIZE);
  const ac = a % BOARD_SIZE;
  const br = Math.floor(b / BOARD_SIZE);
  const bc = b % BOARD_SIZE;
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc)) === 1;
}

function beginSelection(index, pointer) {
  state.pointerActive = true;
  state.selectedPath = [index];
  state.pointer = pointer;
  state.feedback = '계속 이어보세요.';
  state.feedbackTone = 'idle';
  renderBoardState();
}

function extendSelection(index, pointer) {
  if (!state.pointerActive || state.selectedPath.length === 0) return;
  state.pointer = pointer;

  const path = state.selectedPath;
  const last = path[path.length - 1];
  const previous = path[path.length - 2];

  if (index === last) {
    renderBoardState();
    return;
  }

  if (index === previous) {
    path.pop();
    renderBoardState();
    return;
  }

  if (path.includes(index)) return;
  if (!isAdjacent(last, index)) return;

  path.push(index);
  renderBoardState();
}

function clearSelection() {
  state.selectedPath = [];
  state.pointerActive = false;
  state.pointer = null;
}

function submitSelection() {
  if (!state.pointerActive || state.selectedPath.length === 0) return;

  const word = currentWord();
  const answers = answerMap();

  if (word.length < MIN_ANSWER_SYLLABLES || word.length > MAX_ANSWER_SYLLABLES) {
    state.feedback = `${MIN_ANSWER_SYLLABLES}~${MAX_ANSWER_SYLLABLES}음절 단어를 이어주세요.`;
    state.feedbackTone = 'bad';
  } else if (!answers.has(word)) {
    state.feedback = `${withTopicParticle(word)} 보드에서 찾을 수 있는 사전 단어가 아니에요.`;
    state.feedbackTone = 'bad';
  } else if (answers.get(word)?.group === 'bonus' && foundCount() < GOAL_COUNT) {
    state.feedback = `기본 정답 10개를 찾으면 ${word}도 보너스로 인정돼요.`;
    state.feedbackTone = 'idle';
  } else if (state.found.has(word)) {
    state.feedback = `${withTopicParticle(word)} 이미 찾았어요.`;
    state.feedbackTone = 'idle';
  } else {
    const answer = answers.get(word);
    const beforeCount = foundCount();
    state.found.add(word);
    saveFound();
    const afterCount = foundCount();
    const isBonus = answer.group === 'bonus' || afterCount > GOAL_COUNT;
    const anchor = selectionAnchor();
    state.feedback = isBonus ? `${word} 보너스 정답!` : `${word} 찾았어요.`;
    state.feedbackTone = isBonus ? 'bonus' : 'good';
    state.burst = { word, isBonus, id: Date.now(), ...anchor };
    playSuccessHaptic(isBonus);
    if (beforeCount < GOAL_COUNT && afterCount >= GOAL_COUNT) launchGoalConfetti();
  }

  clearSelection();
  render();
}

function tileHitboxInset(size) {
  return Math.max(
    0,
    Math.min(size * TILE_LOCK_INSET_RATIO, (size - MIN_TILE_LOCK_HITBOX_SIZE) / 2),
  );
}

function tileFromPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  const tile = element?.closest?.('[data-cell]');
  if (!tile) return null;

  const rect = tile.getBoundingClientRect();
  const insetX = tileHitboxInset(rect.width);
  const insetY = tileHitboxInset(rect.height);
  const insideLockHitbox = clientX >= rect.left + insetX
    && clientX <= rect.right - insetX
    && clientY >= rect.top + insetY
    && clientY <= rect.bottom - insetY;

  return insideLockHitbox ? tile : null;
}

function handlePointerMove(event) {
  if (!state.pointerActive) return;
  event.preventDefault();
  const point = { x: event.clientX, y: event.clientY };
  const tile = tileFromPoint(event.clientX, event.clientY);
  if (tile) {
    extendSelection(Number(tile.dataset.cell), point);
  } else {
    state.pointer = point;
    renderBoardState();
  }
}

function handlePointerUp(event) {
  event.preventDefault();
  submitSelection();
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  window.removeEventListener('pointercancel', handlePointerUp);
}

function bindTileEvents() {
  document.querySelectorAll('[data-cell]').forEach((tile) => {
    tile.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      tile.setPointerCapture?.(event.pointerId);
      beginSelection(Number(tile.dataset.cell), { x: event.clientX, y: event.clientY });
      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    }, { passive: false });
  });
}

function bindControlEvents() {
  const openHelpButton = document.querySelector('[data-open-help]');
  openHelpButton?.addEventListener('click', openHelp);

  const shareButton = document.querySelector('[data-share-result]');
  shareButton?.addEventListener('click', shareResult);

  const openFoundButton = document.querySelector('[data-open-found]');
  openFoundButton?.addEventListener('click', openFound);

  const startReadyButton = document.querySelector('[data-start-ready]');
  startReadyButton?.addEventListener('click', () => {
    clearSelection();
    startCurrentPuzzle();
  });

  const helpOverlay = document.querySelector('[data-help-overlay]');
  helpOverlay?.addEventListener('click', (event) => {
    if (event.target === helpOverlay) closeHelp();
  });

  const closeHelpButtons = document.querySelectorAll('[data-close-help]');
  closeHelpButtons.forEach((button) => button.addEventListener('click', closeHelp));
  closeHelpButtons[0]?.focus({ preventScroll: true });

  const foundOverlay = document.querySelector('[data-found-overlay]');
  foundOverlay?.addEventListener('click', (event) => {
    if (event.target === foundOverlay) closeFound();
  });

  const closeFoundButtons = document.querySelectorAll('[data-close-found]');
  closeFoundButtons.forEach((button) => button.addEventListener('click', closeFound));
  if (!state.helpOpen) closeFoundButtons[0]?.focus({ preventScroll: true });
}

function handleKeydown(event) {
  if (event.key !== 'Escape') return;
  if (state.helpOpen) {
    closeHelp();
  } else if (state.foundOpen) {
    closeFound();
  }
}

function selectedPoints() {
  const board = document.querySelector('.board');
  if (!board) return [];
  const boardRect = board.getBoundingClientRect();

  const points = state.selectedPath
    .map((index) => document.querySelector(`[data-cell="${index}"]`))
    .filter(Boolean)
    .map((tile) => {
      const rect = tile.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - boardRect.left,
        y: rect.top + rect.height / 2 - boardRect.top,
      };
    });

  if (state.pointerActive && state.pointer && points.length > 0) {
    points.push({
      x: state.pointer.x - boardRect.left,
      y: state.pointer.y - boardRect.top,
      live: true,
    });
  }

  return points;
}

function renderLines() {
  const svg = document.querySelector('.board-lines');
  if (!svg) return;
  const points = selectedPoints();
  const fixedPoints = state.pointerActive ? points.slice(0, -1) : points;
  const livePoint = state.pointerActive ? points[points.length - 1] : null;

  const polyline = fixedPoints.map((point) => `${point.x},${point.y}`).join(' ');
  const liveLine = fixedPoints.length > 0 && livePoint
    ? `<line x1="${fixedPoints[fixedPoints.length - 1].x}" y1="${fixedPoints[fixedPoints.length - 1].y}" x2="${livePoint.x}" y2="${livePoint.y}" />`
    : '';

  svg.innerHTML = `
    <polyline points="${polyline}" />
    ${liveLine}
  `;
}

function renderBoardState() {
  document.querySelectorAll('[data-cell]').forEach((tile) => {
    const index = Number(tile.dataset.cell);
    tile.classList.toggle('selected', state.selectedPath.includes(index));
    tile.classList.toggle('last', state.selectedPath[state.selectedPath.length - 1] === index);
  });

  renderLines();
}

function renderTimer() {
  const timer = document.querySelector('[data-next-timer]');
  if (!timer) return;

  const nextSeed = kstHourSeed(new Date());
  const hasNewPuzzle = nextSeed !== state.seed;

  if (hasNewPuzzle && state.pendingSeed !== nextSeed) {
    state.pendingSeed = nextSeed;
    render();
    return;
  }

  timer.textContent = hasNewPuzzle ? '준비됨' : formatDuration(secondsUntilNextHour(new Date()));
}

function answerChips() {
  const foundWords = [...state.found];
  if (foundWords.length === 0) {
    return '<p class="empty-list">아직 찾은 단어가 없어요.</p>';
  }

  return foundWords
    .map((word, index) => `<span class="chip ${index >= GOAL_COUNT ? 'bonus-chip' : ''}">${word}</span>`)
    .join('');
}

function helpDialog() {
  return `
    <div class="help-overlay" data-help-overlay>
      <section class="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" aria-describedby="help-desc">
        <div class="help-head">
          <h2 id="help-title">게임방법</h2>
          <button type="button" class="icon-button close-help" data-close-help aria-label="게임방법 닫기">×</button>
        </div>
        <p id="help-desc">이어지는 글자를 따라 말이 되는 단어를 찾으세요.</p>
        <ul class="help-list">
          <li>상하좌우와 대각선으로 붙은 글자를 이어요.</li>
          <li>한 단어 안에서 같은 칸은 한 번만 쓸 수 있어요.</li>
          <li>3~6음절, 사전에 있는 단어만 정답이에요.</li>
          <li>10개를 찾으면 목표 달성, 이후 정답은 보너스로 쌓여요.</li>
          <li>한 시간마다 새 판이 준비되고, 원할 때 시작할 수 있어요.</li>
        </ul>
        <button type="button" class="primary-button" data-close-help>시작하기</button>
      </section>
    </div>
  `;
}

function foundDialog(found) {
  return `
    <div class="found-overlay" data-found-overlay>
      <section class="found-modal" role="dialog" aria-modal="true" aria-labelledby="found-title">
        <div class="found-head">
          <div>
            <h2 id="found-title">찾은 정답</h2>
            <span>${found}개</span>
          </div>
          <button type="button" class="icon-button close-found" data-close-found aria-label="찾은 정답 닫기">×</button>
        </div>
        <div class="found-modal-body">
          <div class="chips">${answerChips()}</div>
        </div>
        <button type="button" class="primary-button" data-close-found>닫기</button>
      </section>
    </div>
  `;
}

function render() {
  if (!state.puzzle) {
    app.innerHTML = loadingTemplate();
    return;
  }

  const progress = progressCount();
  const found = foundCount();
  const bonus = bonusCount();
  const complete = found >= GOAL_COUNT;
  const hasNewPuzzle = Boolean(state.pendingSeed && state.pendingSeed !== state.seed);

  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>말잇못</h1>
        </div>
        <div class="top-actions">
          <button type="button" class="icon-button help-button" data-open-help aria-label="게임방법 열기">?</button>
          <a class="icon-button discord-button" href="https://discord.gg/MA6xyVAkt" target="_blank" rel="noopener" aria-label="디스코드 커뮤니티 열기">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.08.08 0 0 0-.08.04c-.21.38-.44.86-.61 1.25a18.3 18.3 0 0 0-5.48 0c-.17-.39-.41-.88-.62-1.25a.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.88 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06c0 .02.01.04.03.06a19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13 12.3 12.3 0 0 1-1.87.89.08.08 0 0 0-.04.11c.36.7.77 1.36 1.23 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.04ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.98 0c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z" />
            </svg>
          </a>
          <button type="button" class="share-button" data-share-result aria-label="결과 공유">결과공유</button>
          <div class="timer-group" aria-label="${hasNewPuzzle ? '새 게임 준비됨' : '다음 게임까지 남은 시간'}">
            <span class="timer-label">${hasNewPuzzle ? '새 게임' : '다음 게임'}</span>
            <div class="timer">
              <strong data-next-timer>${hasNewPuzzle ? '준비됨' : formatDuration(secondsUntilNextHour(new Date()))}</strong>
            </div>
          </div>
        </div>
      </header>

      <section class="status-grid" aria-label="진행 상태">
        <div><span>목표</span><strong>${progress}/${GOAL_COUNT}</strong></div>
        <div><span>찾음</span><strong>${found}</strong></div>
        <div><span>보너스</span><strong>${bonus}</strong></div>
      </section>

      ${hasNewPuzzle ? `
        <section class="new-game-banner" aria-live="polite">
          <div>
            <strong>새 게임이 준비됐어요.</strong>
            <span>#${state.pendingSeed} 판을 바로 시작할 수 있어요.</span>
          </div>
          <button type="button" data-start-ready>시작</button>
        </section>
      ` : ''}

      <section class="board-wrap ${state.burst ? 'success-pop' : ''} ${state.burst?.isBonus ? 'bonus-pop' : ''}" aria-label="${BOARD_SIZE}x${BOARD_SIZE} 말그물 보드">
        <div class="board">
          <svg class="board-lines" aria-hidden="true"></svg>
          ${state.puzzle.board.map((syllable, index) => `
            <button class="tile" type="button" data-cell="${index}" aria-label="${syllable}">
              ${syllable}
            </button>
          `).join('')}
        </div>
        ${state.burst ? `<div class="success-ring ${state.burst.isBonus ? 'bonus' : ''}" style="--burst-x: ${state.burst.x}%; --burst-y: ${state.burst.y}%;" aria-hidden="true"></div>
        <div class="success-sparks ${state.burst.isBonus ? 'bonus' : ''}" style="--burst-x: ${state.burst.x}%; --burst-y: ${state.burst.y}%;" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </div>` : ''}
        ${state.burst ? `<div class="flying-word ${state.burst.isBonus ? 'bonus' : ''}" style="--burst-x: ${state.burst.x}%; --burst-y: ${state.burst.y}%;" key="${state.burst.id}">
          ${state.burst.word}
        </div>` : ''}
      </section>

      <p class="feedback ${state.feedbackTone}" aria-live="polite">${state.feedback}</p>

      <section class="found-summary">
        <button type="button" data-open-found>
          <span>찾은 정답</span>
          <strong>${found}개</strong>
          <em>열기</em>
        </button>
      </section>

      ${complete ? `
        <section class="completion">
          <strong>10개를 찾았어요!</strong>
          <span>계속 이어서 보너스 정답을 더 찾아보세요.</span>
        </section>
      ` : ''}

      <footer class="meta">
        <span>#${state.seed}</span>
        <span>기본모드</span>
      </footer>

      ${state.toast ? `<div class="toast" role="status" aria-live="polite">${state.toast.message}</div>` : ''}
      ${state.helpOpen ? helpDialog() : ''}
      ${state.foundOpen ? foundDialog(found) : ''}
    </main>
  `;

  bindTileEvents();
  bindControlEvents();
  renderBoardState();
  window.requestAnimationFrame(renderLines);
  if (state.burst) {
    const burstId = state.burst.id;
    window.setTimeout(() => {
      if (state.burst?.id !== burstId) return;
      state.burst = null;
      document.querySelector('.board-wrap')?.classList.remove('success-pop', 'bonus-pop');
      document.querySelectorAll('.flying-word, .success-ring, .success-sparks').forEach((element) => element.remove());
    }, 1100);
  }
}

async function boot() {
  try {
    app.innerHTML = loadingTemplate('게임 보드를 만드는 중');
    await nextPaint();

    state.candidates = await loadCandidates();
    app.innerHTML = loadingTemplate('단어 후보를 정리하는 중');
    await nextPaint();

    state.entries = candidateEntries(state.candidates.boardWords ?? state.candidates.words);
    state.coreEntries = candidateEntries(
      state.candidates.coreDeployable && state.candidates.coreBoardWords?.length
        ? state.candidates.coreBoardWords
        : state.candidates.boardWords ?? state.candidates.words,
    );
    state.answerEntries = candidateEntries(state.candidates.boardWords ?? state.candidates.words);
    state.bonusAnswerEntries = candidateEntries(state.candidates.bonusWords ?? []);
    app.innerHTML = loadingTemplate('문제판을 만드는 중');
    await nextPaint();

    state.helpOpen = !hasSeenHelp();
    startCurrentPuzzle();
    enableAdBanner();
    window.setInterval(renderTimer, 1000);
    window.addEventListener('resize', renderLines);
    window.addEventListener('keydown', handleKeydown);
  } catch (error) {
    app.innerHTML = `
      <main class="shell">
        <section class="error">
          <h1>문제판을 열 수 없어요</h1>
          <p>${error.message}</p>
        </section>
      </main>
    `;
  }
}

boot();

})();
