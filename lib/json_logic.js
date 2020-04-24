const jsonLogic = require('json-logic-js');

/*
 *  Convert seconds to date time
*/
jsonLogic.add_operation('secondsToDateTime', function (a) {
    const date = new Date(a * 1000);

    const options = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    };

    return new Intl.DateTimeFormat('de-DE', options).format(date);

    //return date.toISOString();
});

/*
 *  Convert seconds to hours
*/
jsonLogic.add_operation('secondsToHours', function (a) {
    return Math.floor(a / 60) + ':' + ('0' + Math.floor(a % 60)).slice(-2);
});

/*
 *  Convert to string
*/
jsonLogic.add_operation('string', function (a) {
    return a.toString();
});

/*
 *  Check if not null
*/
jsonLogic.add_operation('notNull', function (a) {
    return a !== null;
});

module.exports = jsonLogic;