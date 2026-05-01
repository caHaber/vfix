use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct TermScore {
	pub term: String,
	pub score: f64,
	pub count: u32,
}

#[derive(Serialize, Default)]
pub struct SentimentSummary {
	pub mean: f64,
	pub positive_ratio: f64,
	pub negative_ratio: f64,
	pub neutral_ratio: f64,
	pub bins: Vec<f64>,   // edges, length = bin_count + 1
	pub counts: Vec<u32>, // length = bin_count
}

// ---------- tokenization ----------

pub fn tokenize(input: &str) -> Vec<String> {
	let lower = input.to_lowercase();
	let mut tokens = Vec::new();
	let mut current = String::new();
	for ch in lower.chars() {
		if ch.is_alphanumeric() || ch == '\'' {
			current.push(ch);
		} else if !current.is_empty() {
			push_token(&mut tokens, std::mem::take(&mut current));
		}
	}
	if !current.is_empty() {
		push_token(&mut tokens, current);
	}
	tokens
}

fn push_token(out: &mut Vec<String>, token: String) {
	let trimmed = token.trim_matches('\'');
	if trimmed.is_empty() || trimmed.len() < 2 {
		return;
	}
	if STOPWORDS.binary_search(&trimmed).is_ok() {
		return;
	}
	out.push(trimmed.to_string());
}

// ---------- term frequency / tf-idf ----------

pub fn term_frequency(docs: &[&str], top_n: usize) -> Vec<TermScore> {
	let mut counts: HashMap<String, u32> = HashMap::new();
	for doc in docs {
		for tok in tokenize(doc) {
			*counts.entry(tok).or_insert(0) += 1;
		}
	}
	let mut scored: Vec<(String, u32)> = counts.into_iter().collect();
	scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
	scored.into_iter().take(top_n)
		.map(|(term, count)| TermScore { term, score: count as f64, count })
		.collect()
}

pub fn tf_idf(docs: &[&str], top_n: usize) -> Vec<TermScore> {
	let n_docs = docs.len();
	if n_docs == 0 {
		return Vec::new();
	}
	let mut tokenized: Vec<Vec<String>> = docs.iter().map(|d| tokenize(d)).collect();
	let mut doc_freq: HashMap<String, u32> = HashMap::new();
	for doc in &tokenized {
		let mut seen = std::collections::HashSet::new();
		for tok in doc {
			if seen.insert(tok.clone()) {
				*doc_freq.entry(tok.clone()).or_insert(0) += 1;
			}
		}
	}
	let mut scores: HashMap<String, (f64, u32)> = HashMap::new();
	for doc in &mut tokenized {
		if doc.is_empty() {
			continue;
		}
		let len = doc.len() as f64;
		let mut local: HashMap<String, u32> = HashMap::new();
		for tok in doc.drain(..) {
			*local.entry(tok).or_insert(0) += 1;
		}
		for (term, count) in local {
			let tf = count as f64 / len;
			let df = *doc_freq.get(&term).unwrap_or(&1) as f64;
			let idf = ((n_docs as f64 + 1.0) / (df + 1.0)).ln() + 1.0;
			let entry = scores.entry(term).or_insert((0.0, 0));
			entry.0 += tf * idf;
			entry.1 += count;
		}
	}
	let mut scored: Vec<(String, f64, u32)> = scores.into_iter()
		.map(|(t, (s, c))| (t, s, c))
		.collect();
	scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
	scored.into_iter().take(top_n)
		.map(|(term, score, count)| TermScore { term, score, count })
		.collect()
}

// ---------- RAKE-lite (multi-word phrases) ----------

pub fn rake_keywords(docs: &[&str], top_n: usize) -> Vec<TermScore> {
	let mut phrase_scores: HashMap<String, (f64, u32)> = HashMap::new();
	for doc in docs {
		let lower = doc.to_lowercase();
		let mut current: Vec<String> = Vec::new();
		let mut buf = String::new();
		let mut chars = lower.chars().peekable();
		while let Some(ch) = chars.next() {
			let is_word_char = ch.is_alphanumeric() || ch == '\'';
			if is_word_char {
				buf.push(ch);
			}
			let is_break = !is_word_char || chars.peek().is_none();
			if is_break {
				let word = buf.trim_matches('\'').to_string();
				buf.clear();
				let is_stop = word.len() < 2 || STOPWORDS.binary_search(&word.as_str()).is_ok();
				let is_punct_break = matches!(ch, '.' | ',' | ';' | ':' | '!' | '?' | '\n' | '\r');
				if !word.is_empty() && !is_stop {
					current.push(word);
				}
				if (is_stop || is_punct_break || chars.peek().is_none()) && !current.is_empty() {
					let phrase = current.join(" ");
					let word_count = current.len() as f64;
					let degree = word_count - 1.0 + word_count;
					let score = degree / word_count.max(1.0);
					let entry = phrase_scores.entry(phrase).or_insert((0.0, 0));
					entry.0 += score;
					entry.1 += 1;
					current.clear();
				}
			}
		}
		if !current.is_empty() {
			let phrase = current.join(" ");
			let entry = phrase_scores.entry(phrase).or_insert((0.0, 0));
			entry.0 += 1.0;
			entry.1 += 1;
		}
	}
	let mut scored: Vec<(String, f64, u32)> = phrase_scores.into_iter()
		.filter(|(p, _)| p.contains(' ') || p.len() > 3)
		.map(|(p, (s, c))| (p, s * (c as f64).sqrt(), c))
		.collect();
	scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
	scored.into_iter().take(top_n)
		.map(|(term, score, count)| TermScore { term, score, count })
		.collect()
}

// ---------- sentiment ----------

pub fn sentiment_score(input: &str) -> f64 {
	let lower = input.to_lowercase();
	let mut total = 0.0_f64;
	let mut tokens = 0u32;
	let mut negate_next = false;
	let mut current = String::new();
	let process = |word: &str, total: &mut f64, tokens: &mut u32, negate_next: &mut bool| {
		if word.is_empty() {
			return;
		}
		*tokens += 1;
		if NEGATIONS.binary_search(&word).is_ok() {
			*negate_next = true;
			return;
		}
		if let Ok(idx) = AFINN.binary_search_by_key(&word, |entry| entry.0) {
			let mut score = AFINN[idx].1 as f64;
			if *negate_next {
				score = -score;
			}
			*total += score;
		}
		*negate_next = false;
	};
	for ch in lower.chars() {
		if ch.is_alphanumeric() || ch == '\'' {
			current.push(ch);
		} else if !current.is_empty() {
			let word = std::mem::take(&mut current);
			let trimmed = word.trim_matches('\'');
			process(trimmed, &mut total, &mut tokens, &mut negate_next);
			if matches!(ch, '.' | '!' | '?' | ',' | ';' | ':' | '\n') {
				negate_next = false;
			}
		}
	}
	if !current.is_empty() {
		let word = current.trim_matches('\'').to_string();
		process(&word, &mut total, &mut tokens, &mut negate_next);
	}
	if tokens == 0 {
		return 0.0;
	}
	let normalized = total / (tokens as f64).sqrt();
	// AFINN range is -5..+5, after sqrt-norm we clamp to -1..+1 with /5.
	(normalized / 5.0).clamp(-1.0, 1.0)
}

pub fn sentiment_summary(scores: &[f64], bin_count: usize) -> SentimentSummary {
	let n = scores.len() as f64;
	if n == 0.0 {
		return SentimentSummary::default();
	}
	let mean = scores.iter().sum::<f64>() / n;
	let pos = scores.iter().filter(|s| **s > 0.05).count() as f64 / n;
	let neg = scores.iter().filter(|s| **s < -0.05).count() as f64 / n;
	let neu = 1.0 - pos - neg;
	let mut bins = Vec::with_capacity(bin_count + 1);
	let lo = -1.0;
	let hi = 1.0;
	let width = (hi - lo) / bin_count as f64;
	for i in 0..=bin_count {
		bins.push(lo + width * i as f64);
	}
	let mut counts = vec![0u32; bin_count];
	for &s in scores {
		let s = s.clamp(lo, hi);
		let mut idx = ((s - lo) / width).floor() as usize;
		if idx >= bin_count {
			idx = bin_count - 1;
		}
		counts[idx] += 1;
	}
	SentimentSummary {
		mean,
		positive_ratio: pos,
		negative_ratio: neg,
		neutral_ratio: neu,
		bins,
		counts,
	}
}

// ---------- embedded data ----------

// Curated AFINN-style lexicon. Words MUST stay sorted (binary search).
// Scores roughly follow AFINN-165 conventions: -5..+5.
static AFINN: &[(&str, i8)] = &[
	("abandon", -2), ("abuse", -3), ("accept", 1), ("accomplish", 2), 
	("accomplished", 2), ("accurate", 2), ("admire", 3), ("admired", 3), 
	("adore", 3), ("adored", 3), ("adoring", 3), ("advantage", 2), 
	("afraid", -2), ("aggressive", -2), ("agony", -3), ("alarm", -2), 
	("alarmed", -2), ("alarming", -3), ("amazing", 4), ("amazingly", 4), 
	("ambitious", 2), ("amused", 3), ("amusing", 3), ("anger", -3), 
	("angry", -3), ("annoy", -2), ("annoyed", -2), ("annoying", -2), 
	("anxious", -2), ("apologize", -1), ("appalling", -3), ("appeal", 2), 
	("appreciate", 2), ("approve", 2), ("argue", -1), ("arrogant", -2), 
	("ashamed", -2), ("assault", -3), ("astonished", 2), ("attack", -1), 
	("authentic", 2), ("avoid", -1), ("awesome", 4), ("awful", -3), 
	("awkward", -2), ("bad", -3), ("badly", -3), ("ban", -2), 
	("battle", -1), ("beautiful", 3), ("beauty", 3), ("believe", 1), 
	("benefit", 2), ("best", 3), ("better", 2), ("bizarre", -2), 
	("blame", -2), ("bless", 2), ("blessed", 3), ("bliss", 3), 
	("blunder", -2), ("bored", -2), ("boring", -3), ("brave", 2), 
	("breakthrough", 3), ("bright", 1), ("brilliant", 4), ("broken", -1), 
	("brutal", -3), ("calm", 2), ("cancel", -1), ("careful", 2), 
	("careless", -2), ("celebrate", 3), ("certain", 1), ("challenge", -1), 
	("charm", 3), ("charming", 3), ("cheap", -2), ("cheat", -3), 
	("cheerful", 3), ("clean", 2), ("clear", 1), ("clever", 2), 
	("comfort", 2), ("comfortable", 2), ("comforting", 2), ("complain", -2), 
	("complaint", -2), ("complete", 1), ("complicated", -1), ("confident", 2), 
	("conflict", -2), ("confused", -2), ("congratulations", 2), ("convenient", 2), 
	("cool", 1), ("corrupt", -3), ("crash", -2), ("crazy", -2), 
	("creative", 2), ("crisis", -3), ("critical", -2), ("criticize", -2), 
	("crushed", -2), ("cry", -2), ("cute", 2), ("damage", -3), 
	("damaged", -2), ("danger", -2), ("dangerous", -2), ("dark", -1), 
	("dead", -3), ("death", -2), ("decent", 1), ("defeat", -2), 
	("deficient", -2), ("delight", 3), ("delighted", 3), ("delightful", 3), 
	("deny", -2), ("depressed", -2), ("depressing", -2), ("despair", -3), 
	("desperate", -3), ("destroy", -3), ("destroyed", -3), ("devastating", -3), 
	("difficult", -1), ("disagree", -2), ("disappoint", -2), ("disappointed", -2), 
	("disappointing", -2), ("disaster", -3), ("disastrous", -3), ("disgust", -3), 
	("disgusted", -3), ("disgusting", -3), ("dislike", -2), ("dismal", -2), 
	("dispute", -2), ("disrupt", -2), ("dissatisfied", -2), ("distress", -3), 
	("disturbing", -2), ("doubt", -1), ("dread", -2), ("dreadful", -3), 
	("dreary", -2), ("dull", -2), ("eager", 1), ("ease", 2), 
	("easy", 1), ("efficient", 2), ("elated", 3), ("embarrass", -2), 
	("embarrassed", -2), ("emergency", -2), ("empower", 2), ("empty", -1), 
	("encouraging", 2), ("energetic", 2), ("engaging", 2), ("enjoy", 3), 
	("enjoyable", 3), ("enjoyed", 3), ("enthusiastic", 3), ("envy", -1), 
	("error", -2), ("evil", -3), ("excellent", 4), ("excited", 3), 
	("exciting", 3), ("exhausted", -2), ("expensive", -1), ("expert", 2), 
	("fabulous", 4), ("fail", -2), ("failed", -2), ("failure", -2), 
	("fair", 1), ("faith", 2), ("fake", -2), ("famous", 1), 
	("fantastic", 4), ("fascinated", 2), ("fascinating", 3), ("favor", 2), 
	("favorite", 2), ("fear", -2), ("fearful", -2), ("fed", -1), 
	("filthy", -3), ("fine", 1), ("flaw", -2),
	("flawed", -2), ("flexible", 2), ("flop", -2), ("forget", -1), 
	("forgive", 2), ("fortunate", 2), ("fragile", -1), ("free", 1), 
	("freedom", 2), ("fresh", 1), ("friend", 1), ("friendly", 2), 
	("frightening", -3), ("frustrate", -2), ("frustrated", -2), ("frustrating", -2), 
	("fun", 4), ("funny", 4), ("furious", -3), ("genius", 4), 
	("genuine", 2), ("glad", 3), ("gloom", -2), ("gloomy", -2), 
	("glorious", 3), ("good", 3), ("graceful", 2), ("grateful", 3), 
	("great", 3), ("grief", -2), ("grim", -2), ("grin", 2), 
	("gruesome", -3), ("grumpy", -2), ("guilty", -3), ("happy", 3), 
	("hard", -1), ("harm", -2), ("harmful", -2), ("hate", -3), 
	("hated", -3), ("hateful", -3), ("hates", -3), ("hating", -3), 
	("hazard", -2), ("hazardous", -3), ("healthy", 2), ("heartbreaking", -3), 
	("heartwarming", 3), ("hell", -3), ("helpful", 2), ("hesitant", -1), 
	("hide", -1), ("hilarious", 4), ("hindrance", -2), ("hopeful", 2), 
	("hopeless", -3), ("horrendous", -3), ("horrible", -3), ("horrified", -3), 
	("hostile", -3), ("huge", 1), ("humble", 1), ("humiliated", -3), 
	("humor", 2), ("hurt", -2), ("hurts", -2), ("idiot", -3), 
	("ignorant", -2), ("ignore", -1), ("ill", -2), ("illegal", -3), 
	("imaginative", 2), ("imperfect", -1), ("important", 2), ("impressed", 2), 
	("impressive", 3), ("improve", 2), ("improved", 2), ("improving", 2), 
	("incompetent", -2), ("inconvenient", -2), ("incorrect", -2), ("incredible", 3), 
	("indecisive", -2), ("inferior", -2), ("inferno", -2), ("innovate", 2), 
	("innovative", 2), ("insane", -2), ("insecure", -2), ("inspire", 2), 
	("inspired", 2), ("inspiring", 3), ("insult", -3), ("insulted", -3), 
	("intelligent", 2), ("interesting", 2), ("invalid", -2), ("issue", -1), 
	("jealous", -2), ("joke", 2), ("jolly", 2), ("joy", 3), 
	("joyful", 3), ("kind", 2), ("kindness", 3), ("lame", -2), 
	("laugh", 2), ("laughed", 2), ("laughing", 2), ("laughter", 3), 
	("lazy", -1), ("lethal", -3), ("liar", -3), ("lie", -2), 
	("lies", -2), ("like", 1), ("liked", 2), ("limited", -1), 
	("loathe", -3), ("lonely", -2), ("loser", -3), ("lost", -2), 
	("love", 3), ("loved", 3), ("loves", 3), ("loving", 2), 
	("loyal", 2), ("lucky", 2), ("mad", -3), ("magic", 1), 
	("magnificent", 4), ("malicious", -3), ("marvelous", 4), ("masterpiece", 3), 
	("matters", 1), ("mean", -2), ("mediocre", -2), ("melt", 1), 
	("messy", -2), ("miracle", 3), ("misery", -3), ("misleading", -2), 
	("miss", -2), ("missing", -2), ("mistake", -2), ("misunderstand", -2), 
	("mock", -2), ("mocked", -2), ("moody", -2), ("mourn", -2), 
	("nasty", -3), ("needy", -1), ("neglect", -2), ("nervous", -2), 
	("neutral", 0), ("nice", 3), ("noble", 2), ("noisy", -1), 
	("normal", 0), ("nostalgic", 1), ("notorious", -2), ("nuisance", -2), 
	("obnoxious", -3), ("ok", 0), ("okay", 0), ("optimistic", 2), 
	("outstanding", 4), ("overjoyed", 3), ("overpriced", -2), ("overwhelmed", -2), 
	("painful", -2), ("panic", -3), ("paradise", 3), ("passion", 2), 
	("passionate", 3), ("pathetic", -3), ("peaceful", 2), ("perfect", 3), 
	("perfectly", 3), ("petty", -2), ("phenomenal", 4), ("pity", -1), 
	("pleasant", 3), ("pleased", 3), ("pleasure", 3), ("plight", -2), 
	("polite", 2), ("poor", -2), ("popular", 2), ("positive", 2), 
	("powerful", 2), ("praise", 3), ("prayer", 1), ("prejudice", -2), 
	("pretty", 1), ("priceless", 3), ("pride", 2), ("problem", -2), 
	("problems", -2), ("productive", 2), ("progress", 2), ("promise", 1), 
	("promising", 2), ("proud", 2), ("punish", -2), ("punishment", -2), 
	("pure", 1), ("quirky", 1), ("rage", -3), ("rapid", 1), 
	("rare", 1), ("reach", 1), ("ready", 1), ("rebel", -1), 
	("recommend", 2), ("recover", 2), ("recovered", 2), ("regret", -2), 
	("regretted", -2), ("reject", -2), ("rejected", -2), ("relax", 2), 
	("relaxed", 2), ("relaxing", 3), ("relevant", 1), ("reliable", 2), 
	("relief", 2), ("relieved", 2), ("reluctant", -1), ("remarkable", 3), 
	("remorse", -2), ("repair", 1), ("repulsive", -3), ("rescue", 2), 
	("resentment", -2), ("respected", 2), ("responsible", 2), ("restless", -1), 
	("revenge", -2), ("revolting", -3), ("reward", 2), ("rewarding", 3), 
	("ridiculous", -2), ("rip", -2), ("ripoff", -3), ("risk", -1), 
	("risky", -2), ("rude", -3), ("ruin", -2), ("ruined", -3), 
	("sad", -3), ("sadly", -2), ("sadness", -2), ("safe", 1), 
	("satisfied", 3), ("satisfying", 3), ("scam", -3), ("scared", -2), 
	("scary", -2), ("scream", -2), ("secure", 2), ("seem", 0), 
	("selfish", -2), ("sensational", 4), ("serious", -1), ("severe", -2), 
	("shame", -2), ("shameful", -3), ("shock", -2), ("shocked", -2), 
	("shocking", -2), ("silly", -1), ("simple", 1), ("sincere", 2), 
	("sketchy", -2), ("slow", -1), ("smart", 2), ("smile", 2), 
	("smiled", 2), ("smiles", 2), ("smiling", 2), ("smooth", 1), 
	("solid", 1), ("sorrow", -2), ("sorry", -1), ("special", 2), 
	("spectacular", 4), ("splendid", 3), ("stable", 2), ("steal", -2), 
	("stellar", 4), ("stress", -2), ("stressful", -2), ("strong", 2), 
	("struggle", -2), ("struggling", -2), ("stunning", 4), ("stupid", -3), 
	("succeed", 2), ("success", 3), ("successful", 3), ("suck", -3), 
	("sucks", -3), ("suffer", -2), ("suffering", -2), ("super", 3), 
	("superb", 4), ("superior", 2), ("support", 2), ("supportive", 2), 
	("supreme", 3), ("sure", 1), ("surprise", 1), ("surprised", 1), 
	("surprising", 1), ("survive", 2), ("suspect", -1), ("suspicious", -2), 
	("sweet", 2), ("sympathy", 2), ("talented", 3), ("tedious", -2), 
	("tense", -2), ("terrible", -3), ("terribly", -3), ("terrific", 4), 
	("terrified", -3), ("terrifying", -3), ("thank", 2), ("thankful", 2), 
	("thanks", 2), ("thoughtful", 2), ("threat", -2), ("threatening", -3), 
	("thrilled", 3), ("thrilling", 3), ("tired", -2), ("tolerable", 1), 
	("torture", -3), ("tough", -1), ("tragedy", -3), ("tragic", -3), 
	("tranquil", 2), ("trapped", -2), ("trauma", -3), ("treacherous", -3), 
	("treasure", 2), ("trouble", -2), ("troubled", -2), ("trust", 2), 
	("trusted", 2), ("truth", 1), ("ugly", -3), ("unable", -2), 
	("unacceptable", -3), ("unbelievable", 1), ("uncomfortable", -2), ("undermine", -2), 
	("uneasy", -2), ("unequal", -1), ("unethical", -2), ("unfair", -2), 
	("unfortunate", -2), ("unhappy", -2), ("unhealthy", -2), ("unique", 2), 
	("unlucky", -2), ("unpleasant", -3), ("unprofessional", -3), ("unreliable", -2), 
	("unsafe", -2), ("unsatisfied", -2), ("unstable", -2), ("unwanted", -2), 
	("upbeat", 2), ("upset", -2), ("useful", 2), ("useless", -3), 
	("vibrant", 2), ("victim", -2), ("victorious", 3), ("victory", 3), 
	("vile", -3), ("violence", -3), ("violent", -3), ("vital", 2), 
	("vivid", 1), ("vulnerable", -2), ("waste", -2), ("wasted", -2), 
	("weak", -2), ("welcome", 2), ("welcoming", 2), ("well", 1), 
	("wicked", -2), ("wild", 0), ("win", 3), ("winner", 3), 
	("winning", 3), ("wise", 2), ("witty", 2), ("woes", -2), 
	("won", 3), ("wonderful", 4), ("wondrous", 3), ("worried", -2), 
	("worry", -2), ("worse", -3), ("worship", 2), ("worst", -3), 
	("worthless", -3), ("worthy", 2), ("wow", 4), ("wrong", -2), 
	("yay", 3), ("yearn", 1), ("zealous", 1), 
];

// Negation triggers — flip the next AFINN-matched word.
// Sorted alphabetically for binary search.
static NEGATIONS: &[&str] = &[
	"ain't", "aint", "cannot", "cant", "couldn't", "couldnt",
	"didn't", "didnt", "doesn't", "doesnt", "don't", "dont",
	"hadn't", "hadnt", "hasn't", "hasnt", "haven't", "havent",
	"isn't", "isnt", "never", "no", "none", "nor", "not",
	"nothing", "nowhere", "shouldn't", "shouldnt", "wasn't", "wasnt",
	"weren't", "werent", "without", "won't", "wont",
	"wouldn't", "wouldnt",
];

// Common English stopwords. Sorted alphabetically for binary search.
static STOPWORDS: &[&str] = &[
	"a", "about", "above", "after", "again", "against", "all", "am",
	"an", "and", "any", "are", "aren't", "as", "at", "be",
	"because", "been", "before", "being", "below", "between", "both", "but",
	"by", "can", "could", "did", "do", "does", "doing", "down",
	"during", "each", "few", "for", "from", "further", "had", "has",
	"have", "having", "he", "her", "here", "hers", "herself", "him",
	"himself", "his", "how", "i", "if", "in", "into", "is",
	"it", "its", "itself", "just", "let", "lets", "me", "might",
	"more", "most", "my", "myself", "of", "off", "on", "once",
	"only", "or", "other", "ought", "our", "ours", "ourselves", "out",
	"over", "own", "same", "shall", "she", "should", "so", "some",
	"such", "than", "that", "the", "their", "theirs", "them", "themselves",
	"then", "there", "these", "they", "this", "those", "through", "to",
	"too", "under", "until", "up", "very", "was", "we", "were",
	"what", "when", "where", "which", "while", "who", "whom", "why",
	"will", "with", "would", "you", "your", "yours", "yourself", "yourselves",
];

// ---------- inline tests ----------

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn afinn_is_sorted() {
		for w in AFINN.windows(2) {
			assert!(w[0].0 < w[1].0, "AFINN not sorted at: {} vs {}", w[0].0, w[1].0);
		}
	}

	#[test]
	fn stopwords_are_sorted() {
		for w in STOPWORDS.windows(2) {
			assert!(w[0] < w[1], "STOPWORDS not sorted at: {} vs {}", w[0], w[1]);
		}
	}

	#[test]
	fn negations_are_sorted() {
		for w in NEGATIONS.windows(2) {
			assert!(w[0] < w[1], "NEGATIONS not sorted at: {} vs {}", w[0], w[1]);
		}
	}

	#[test]
	fn tokenize_drops_stopwords() {
		let toks = tokenize("The quick brown fox is great.");
		assert!(!toks.contains(&"the".to_string()));
		assert!(!toks.contains(&"is".to_string()));
		assert!(toks.contains(&"quick".to_string()));
		assert!(toks.contains(&"great".to_string()));
	}

	#[test]
	fn sentiment_positive() {
		let s = sentiment_score("This is amazing and wonderful");
		assert!(s > 0.2, "expected positive, got {}", s);
	}

	#[test]
	fn sentiment_negative() {
		let s = sentiment_score("Terrible product, completely awful");
		assert!(s < -0.2, "expected negative, got {}", s);
	}

	#[test]
	fn sentiment_negation() {
		let pos = sentiment_score("This is great");
		let neg = sentiment_score("This is not great");
		assert!(neg < pos, "negation should reduce score: {} vs {}", neg, pos);
	}

	#[test]
	fn tf_idf_finds_distinctive_terms() {
		let docs = vec![
			"battery dies fast battery battery",
			"screen is great",
			"shipping was fast",
		];
		let scores = tf_idf(&docs, 5);
		assert!(scores.iter().any(|t| t.term == "battery"));
	}
}
