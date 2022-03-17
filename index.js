const fs = require('fs');
const wd = require("word-definition");
 
const fetch = require('node-fetch');

/** Function that count occurrences of a substring in a string;
 * @param {String} string               The string
 * @param {String} subString            The sub string to search for
 * @param {Boolean} [allowOverlapping]  Optional. (Default:false)
 *
 * @author Vitim.us https://gist.github.com/victornpb/7736865
 * @see Unit Test https://jsfiddle.net/Victornpb/5axuh96u/
 * @see https://stackoverflow.com/a/7924240/938822
 */
function occurrences(string, subString, allowOverlapping) {

    string += "";
    subString += "";
    if (subString.length <= 0) return (string.length + 1);

    var n = 0,
        pos = 0,
        step = allowOverlapping ? 1 : subString.length;

    while (true) {
        pos = string.indexOf(subString, pos);
        if (pos >= 0) {
            ++n;
            pos += step;
        } else break;
    }
    return n;
}

class ExplainResponse {
    /**
     * A wrapper for all responses from this package.
     * @param {Object} data Data to be applied to an ExplainResponse class
     */
    constructor (data) {
        for (const key in data) {
            this[key] = data[key];
        }
    }
}

async function explorePage (subject) {
    const pageRes = await fetch('https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext&redirects=1&titles=' + encodeURIComponent(subject), {
        headers: {
            'User-Agent': 'Explain-This/0.0 (https://yodacode.xyz/; yoda@yodacode.xyz) explain-this/0.0'
        }
    });
    const blurbRes = await fetch('https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro&explaintext&redirects=1&titles=' + encodeURIComponent(subject), {
        headers: {
            'User-Agent': 'Explain-This/0.0 (https://yodacode.xyz/; yoda@yodacode.xyz) explain-this/0.0'
        }
    });
    const pageJson = await pageRes.json();
    const blurbJson = await blurbRes.json();
    let blurb = Object.values(blurbJson.query.pages)[0].extract;
    let page = Object.values(pageJson.query.pages)[0].extract;
    return {
        blurb,
        content: page,
        title: subject
    };
}

/**
 * 
 * @param {String} subject The subject to find a definition or a Wikipedia page for 
 * @param {String[]} context Context to find the best Wikipedia article for the subject
 * @returns {Promise<ExplainResponse>} Returns an ExplainResponse
 */
function explain (subject, context = []) {
    return new Promise(async (resolve, reject) => {
        let timedOut = false;
        let returned = false;
        let timeoutId = 0;
        async function useDetail () {
            returned = true;
            if (timeoutId) clearTimeout(timeoutId);
            const searchRes = await fetch('https://en.wikipedia.org/w/api.php?action=opensearch&limit=3&search=' + encodeURIComponent(subject) + '&profile=fuzzy&format=json', {
                headers: {
                    'User-Agent': 'Explain-This/0.0 (https://yodacode.xyz/; yoda@yodacode.xyz) explain-this/0.0'
                }
            });
            const searchJson = await searchRes.json();
            const searchResults = searchJson[1];
            let pages = [];
            for (const result of searchResults) {
                let { blurb, content, title } = await explorePage(result);
                let sentence = blurb;
                if (!blurb || !content) {
                    pages.push({ blurb, sentence, content, title, related: 0 });
                    continue;
                }
                let matches = blurb.match(/(.|\n)*?[A-Za-z0-9][A-Za-z0-9]\. [A-Za-z0-9]/g);
                let match = matches ? matches[0] : undefined;
                if (match) sentence = match.substring(0, match.length - 2);
                else sentence = blurb.substring(0, blurb.indexOf('. '));
                const lowercaseContent = content.toLowerCase()
                let related = 0;
                for (const word of context) {
                    related += occurrences(lowercaseContent, ` ${word.trim().toLowerCase()} `, false);
                }
                related = related / content.length * 100;
                pages.push({ blurb, content, title, related, sentence });
            }
            if (searchResults.length == 0) return resolve(new ExplainResponse({
                type: 'error',
                value: 'Could not identify this subject.',
                confidence: 0,
                input: subject,
                expanded: {
                    value: 'Could not identify this subject.'
                }
            }));
            pages = pages.sort((a, b) => b.related - a.related);
            let topResult = pages[0];
            if (pages[0] && pages[1]) {
                if (pages[0].related < pages[1].related * 1.5) {
                    topResult = pages.filter(page => page.title == searchResults[0])[0];
                }
            }
            return resolve(new ExplainResponse({
                type: 'wikipedia',
                value: topResult.sentence,
                confidence: 0.5,
                input: subject,
                expanded: {
                    topResult: topResult,
                    allResults: pages,
                    search: subject,
                    rankings: pages.map(page => ({
                        title: page.title,
                        related: page.related
                    }))
                }
            }));
        }
        wd.getDef(subject, "en", null, async function(definition) {
            if (!timedOut) {
                if (!definition.definition) return await useDetail();
                returned = true;
                if (timeoutId) clearTimeout(timeoutId);
                return resolve(new ExplainResponse({
                    type: 'definition',
                    confidence: 0.5,
                    value: definition.definition,
                    input: subject,
                    expanded: definition
                }));
            }
        });
        timeoutId = setTimeout(async () => {
            timedOut = true;
            if (!returned) await useDetail();
        }, 5000);
    });
}

/**
 * Takes in a list of words and explains them, using the list as context.
 * @param {String[]} wordList A list of words to explain
 * @param {Function} onEach callback to run after each response
 * @returns {Promise<Array<ExplainResponse>>} Returns an array of ExplainResponses
 */
async function explainManyRelated (wordList, onEach) {
    const words = {};
    for (const word of wordList) {
        words[word] = await explain(word, wordList);
        onEach(words[word]);
    }
    return words;
}

module.exports = {
    explain,
    explainManyRelated
}