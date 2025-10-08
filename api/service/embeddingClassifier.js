const ROUTES = {
    DIRECT: 'DIRECT',
    REFERENCE: 'REFERENCE',
    EXPLORATORY: 'EXPLORATORY',
    COMPARATIVE: 'COMPARATIVE',
};

const PROTOTYPES = {
    [ROUTES.DIRECT]: [
        'DIRECT queries name a specific title or identifier.',
        'single exact work identifier',
        'East of Eden',
        '978-0-14-118528-6',
        '"The Lion, the Witch and the Wardrobe"',
        'doi:10.1145/3290605.3300233',
        'OCLC 53932143',
        'ISBN 9780306406157',
    ],
    [ROUTES.REFERENCE]: [
        'REFERENCE queries describe one specific work using attributes.',
        'a red book published around 1993 about dinosaurs',
        'a novel about a boy who lives in a bubble',
        'the memoir written by that astronaut who had a dog on the cover',
        'a kids’ book with talking trains from the 1980s',
        'the biography of a woman scientist who discovered radiation',
        'looking for the movie where the hero saves the town from a storm',
    ],
    [ROUTES.EXPLORATORY]: [
        'EXPLORATORY queries seek information about a broader topic.',
        'books about blacksmithing',
        'articles on the interplanetary file system',
        'research papers about coral reef ecology',
        'history of medieval trade guilds',
        'textbooks on linear algebra for engineers',
        'resources covering 19th century abolitionist movements',
    ],
    [ROUTES.COMPARATIVE]: [
        'COMPARATIVE queries ask for similar works to a known item.',
        'books like The Lion, the Witch and the Wardrobe',
        'similar to Dune but more political',
        'if I liked Neuromancer what should I read next',
        'stories like The Martian but set underwater',
        'movies or books with the same vibe as Pride and Prejudice',
        'recommendations similar to Educated by Tara Westover',
    ],
};

const tokenize = (value) => {
    if (!value) {
        return [];
    }

    return (value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean);
};

const buildVector = (tokens) => {
    const vector = new Map();
    tokens.forEach((token) => {
        const current = vector.get(token) || 0;
        vector.set(token, current + 1);
    });
    return vector;
};

const addToVector = (target, source) => {
    source.forEach((value, key) => {
        const current = target.get(key) || 0;
        target.set(key, current + value);
    });
    return target;
};

const scaleVector = (vector, scalar) => {
    const scaled = new Map();
    vector.forEach((value, key) => {
        scaled.set(key, value * scalar);
    });
    return scaled;
};

const dotProduct = (a, b) => {
    let sum = 0;
    const [shorter, longer] = a.size <= b.size ? [a, b] : [b, a];
    shorter.forEach((value, key) => {
        if (longer.has(key)) {
            sum += value * longer.get(key);
        }
    });
    return sum;
};

const vectorMagnitude = (vector) => Math.sqrt(dotProduct(vector, vector)) || 0;

const cosineSimilarity = (a, b) => {
    const denominator = vectorMagnitude(a) * vectorMagnitude(b);
    if (denominator === 0) {
        return 0;
    }
    return dotProduct(a, b) / denominator;
};

const buildCentroids = () => {
    const centroids = {};

    Object.entries(PROTOTYPES).forEach(([label, samples]) => {
        const accumulator = new Map();
        samples.forEach((sample) => {
            const vector = buildVector(tokenize(sample));
            addToVector(accumulator, vector);
        });

        const averaged = scaleVector(accumulator, samples.length ? 1 / samples.length : 1);
        centroids[label] = averaged;
    });

    return centroids;
};

const CENTROIDS = buildCentroids();

const classifyQueryEmbedding = (query) => {
    const tokens = tokenize(query);
    const queryVector = buildVector(tokens);

    const scores = {};
    Object.entries(CENTROIDS).forEach(([label, centroid]) => {
        scores[label] = cosineSimilarity(queryVector, centroid);
    });

    const sorted = Object.entries(scores)
        .sort(([, a], [, b]) => b - a);

    const [bestLabel, bestScore] = sorted[0] || [ROUTES.EXPLORATORY, 0];
    const secondScore = sorted[1] ? sorted[1][1] : 0;
    const similarityMargin = bestScore - secondScore;

    return {
        label: bestLabel,
        confidence: bestScore,
        similarityMargin,
        scores,
        tokenCount: tokens.length,
    };
};

module.exports = {
    classifyQueryEmbedding,
    PROTOTYPES,
    ROUTES,
};
