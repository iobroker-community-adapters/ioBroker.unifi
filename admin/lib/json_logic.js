const jsonLogic = require('json-logic-js');
const dateFormat = require('dateformat');

/**
 *  Convert seconds to date time
 */
jsonLogic.add_operation('secondsToDateTime', function (a) {
    const date = new Date(a * 1000);

    return dateFormat(date, 'yyyy-mm-dd HH:MM:ss');
});

/**
 *  Convert seconds to hours
 */
jsonLogic.add_operation('secondsToHours', function (a) {
    return Math.floor(a / 60) + ':' + ('0' + Math.floor(a % 60)).slice(-2);
});

/**
 *  Convert to string
 */
jsonLogic.add_operation('string', function (a) {
    return a.toString();
});

/**
 *  Check if not null
 */
jsonLogic.add_operation('notNull', function (a) {
    return a !== null;
});

/**
 * Return value if not null
 */
jsonLogic.add_operation('ifNotNull', function (a, b, c) {
    if (a !== null) {
        return b;
    } else {
        return c;
    }
});

/**
 * Cleanup for use as ID
 */
jsonLogic.add_operation('cleanupForUseAsId', function (a) {
    if (a === null) {
        return null;
    }

    const FORBIDDEN_CHARS = /[\]\[*.,;'"`<>\\?\s]/g;
    let tempId = a.replace(FORBIDDEN_CHARS, '_');
    tempId = tempId.toLowerCase();

    return tempId;
});

/**
 * Translate category code to name
 */
jsonLogic.add_operation('translateCatCodeToName', function (a) {
    const categories = {
        0: 'Instant messengers',
        1: 'Peer-to-peer networks',
        3: 'File sharing services and tools',
        4: 'Media streaming services',
        5: 'Email messaging services',
        6: 'VoIP services',
        7: 'Database tools',
        8: 'Online games',
        9: 'Management tools and protocols',
        10: 'Remote access terminals',
        11: 'Tunneling and proxy services',
        12: 'Investment platforms',
        13: 'Web services',
        14: 'Security update tools',
        15: 'Web instant messengers',
        17: 'Business tools',
        18: 'Network protocols',
        19: 'Network protocols',
        20: 'Network protocols',
        23: 'Private protocols',
        24: 'Social networks',
        255: 'Unknown'
    };

    if (Object.prototype.hasOwnProperty.call(categories, a)) {
        return categories[a];
    } else {
        return 'undefined';
    }
});

/**
 *  Convert timestamp to date
 */
jsonLogic.add_operation('timestampToDate', function (a) {
    const date = new Date(a);

    return dateFormat(date, 'yyyy-mm-dd');
});

/**
 *  Convert timestamp to date
 */
jsonLogic.add_operation('timestampDiffInDaysToNow', function (a, b) {
    var now = new Date();
    var date = new Date(b);
    var diffDays = parseInt((now - date) / (1000 * 60 * 60 * 24), 10);

    return a + diffDays;
});

module.exports = jsonLogic;