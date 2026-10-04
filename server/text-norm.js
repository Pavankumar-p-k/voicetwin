// text-norm.js — shared deterministic text normalization for judging.
// Used by rubric-scorer (evidence points) and answer-analysis (specificity).
// No LLM, no deps: lowercase, contraction expansion (so negation reads work),
// filler-interjection stripping, and spoken number-words -> digits so
// "cut latency by fifty percent" counts the same as "cut latency by 50%".

const CONTRACTIONS = [
  [/won't/g, 'will not'], [/can't/g, 'can not'], [/don't/g, 'do not'],
  [/doesn't/g, 'does not'], [/didn't/g, 'did not'], [/isn't/g, 'is not'],
  [/aren't/g, 'are not'], [/wasn't/g, 'was not'], [/weren't/g, 'were not'],
  [/haven't/g, 'have not'], [/hasn't/g, 'has not'], [/hadn't/g, 'had not'],
  [/wouldn't/g, 'would not'], [/couldn't/g, 'could not'], [/shouldn't/g, 'should not'],
  [/mustn't/g, 'must not'], [/needn't/g, 'need not'], [/i'm/g, 'i am'],
  [/i've/g, 'i have'], [/i'd/g, 'i would'], [/i'll/g, 'i will'],
  [/we're/g, 'we are'], [/we've/g, 'we have'], [/it's/g, 'it is'],
  [/that's/g, 'that is'], [/there's/g, 'there is'], [/let's/g, 'let us'],
];

const FILLER_RE = /\b(um+|uh+|erm+|ah+|hmm+|mm+hmm)\b|\byou know\b|\blike\b(?=,)/g;

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

// "fifty two" -> 52, "two hundred" -> 200, "three thousand" -> 3000,
// lone "fifty" -> 50. A lone "and" is never converted.
function wordsToNumbers(s) {
  const NUM = 'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and';
  return s.replace(new RegExp(`\\b((?:${NUM})(?:\\s+(?:${NUM}))*)\\b`, 'g'), (phrase) => {
    const words = phrase.split(/\s+/).filter((w) => w !== 'and');
    if (!words.length) return phrase;
    let total = 0;
    let current = 0;
    for (const w of words) {
      if (w === 'hundred') current = (current || 1) * 100;
      else if (w === 'thousand') { total += (current || 1) * 1000; current = 0; }
      else if (ONES[w] !== undefined) current += ONES[w];
      else return phrase; // unknown word: leave untouched
    }
    return String(total + current);
  }).replace(/\ba dozen\b/g, '12')
    .replace(/\bhalf\b/g, '0.5');
}

export function normalizeText(raw) {
  let s = String(raw || '').toLowerCase();
  for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  s = wordsToNumbers(s);
  s = s.replace(FILLER_RE, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// True when the match at matchIndex sits inside a negated clause:
// "never measured", "did not profile", "no numbers", "without data",
// "failed to test", "unable to scale". Window covers the words before it.
const NEG_RE = /(not|never|no|without|hardly|barely|failed to|unable to|refused to|did not|do not|does not|could not|can not|would not|will not|lack of|free|clean)\s+[\w\s]{0,28}$/;

export function isNegated(text, matchIndex, windowChars = 32) {
  const before = text.slice(Math.max(0, matchIndex - windowChars), matchIndex);
  return NEG_RE.test(before);
}
