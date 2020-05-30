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
    const FORBIDDEN_CHARS = /[\]\[*.,;'"`<>\\?\s]/g;
    let tempId = a.replace(FORBIDDEN_CHARS, '_');
    tempId = tempId.toLowerCase();
    
    return tempId;
});

module.exports = jsonLogic;