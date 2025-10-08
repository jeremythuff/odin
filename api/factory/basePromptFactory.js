const buildBasePrompt = ({ description, maxCandidates, maxConfidenceGap }) => ({
    system: `
        Operate with a strict pipeline (silently):

            1) Detect COMPARATOR MODE:
            • If the description asks for works "similar to", "like", "reminiscent of", "not", "unlike", "other than", "in the vein of", or equivalent, extract any referenced seed works (titles/series/creators) and activate COMPARATOR MODE.
            • When COMPARATOR MODE is active, the referenced seed works become EXCLUDED SEEDS.

            2) Extract HARD CUES from the description: exact quoted phrases (≥3 words); proper nouns (character/place/institution names); series/volume markers; genre/format; time/place indicators; explicit negatives.

            3) Candidate generation:
            • Prefer candidates satisfying ALL HARD CUES when possible.
            • If COMPARATOR MODE is active: generate candidates that share genre/style/themes with the EXCLUDED SEEDS but are distinct works.

            4) DISQUALIFY step (mandatory):
            • Normalize titles (lowercase; strip punctuation, subtitles after ":" or "—", leading articles).
            • Remove any candidate whose normalized title equals any EXCLUDED SEED title (including well-known aliases).
            • If a candidate is a different edition of an EXCLUDED SEED, remove it unless the description explicitly requests that edition.

            5) Work vs. edition:
            • Prefer the original/canonical work. Only return a specific edition if clearly specified.

            6) Identifiers:
            • Include identifiers (ISBN-13/10, OCLC, LCCN) only when certain they belong to that exact work/edition; otherwise omit.

            7) Scoring:
            • Confidence ∈ [0,1].
            • If the description is an exact, unique title or famous series name and COMPARATOR MODE is NOT active, score that match at 1.00.
            • ≥0.90 only if matching an exact quote AND ≥1 unique proper-noun/series/setting cue with no conflicts.
            • 0.60–0.89 for strong multi-cue matches with no conflicts.
            • BROAD/GENRE RULE: For broad topical queries, return ${maxCandidates} diverse canonical examples; scores may start ≈0.50 and need not converge.

            8) Abstention:
            • Let top = highest confidence found. MIN_CONFIDENCE = top - ${maxConfidenceGap}.
            • Retain only candidates with confidence > MIN_CONFIDENCE.
            • If no candidates, return [].

            9) Evidence:
            • Cite at least one exact cue from the description and give a brief rationale. Do not reveal your chain-of-thought.

            10) Metadata:
            • Use earliest publication year of the work when known.
            • Omit unknown fields rather than emitting null/empty strings.
            • Sort by confidence desc; no duplicates.

            11) Final validation (must pass before output):
            • If COMPARATOR MODE is active, assert that no candidate equals any EXCLUDED SEED (after normalization) and that no candidate is merely a reprint/edition of an EXCLUDED SEED.
            • Output JSON only; if no plausible work exists, return [].
        `.trim(),

    user: `
        Return valid JSON using the following schema. Omit unknown fields entirely; verify identifiers strictly and omit any uncertain identifier.

        Schema (array of objects):
        [
            {
                'title': 'string',
                'authors': ['string', ...],
                'year': number,
                'language': 'string',
                'confidence': number,
                'evidence': 'string',
                'identifiers': {
                'isbn13': 'string',
                'isbn10': 'string',
                'oclc': 'string',
                'lccn': 'string'
                'doi': 'string'
                }
            }
        ]

        Description:
        ${description}
        `.trim(),
});

module.exports = buildBasePrompt;
