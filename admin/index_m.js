/**
 * Encryption
 */
let secret;

function encrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

function decrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

/**
 * Chips
 */
function list2chips(selector, list, onChange) {
    const data = [];

    list.sort();

    for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].trim()) {
            data.push({ tag: list[i].trim() });
        }
    }

    $(selector).chips({
        data: data,
        placeholder: _('Add'),
        secondaryPlaceholder: _('Add'),
        onChipAdd: onChange,
        onChipDelete: onChange
    });
}

function chips2list(selector) {
    const data = $(selector).chips('getData');

    const list = [];
    for (let i = 0; i < data.length; i++) {
        list.push(data[i].tag);
    }

    list.sort();

    return list;
}

/**
 * the function loadSettings has to exist ...
 * @param {*} settings 
 * @param {*} onChange 
 */
function loadHelper(settings, onChange) {
    // example: select elements with id=key and class=value and insert value
    if (!settings) return;
    if (settings.electricityPollingInterval === undefined) settings.electricityPollingInterval = 20;

    $('.value').each(function () {
        const $key = $(this);
        const id = $key.attr('id');
        if (id === 'controllerPassword') {
            settings[id] = decrypt(secret, settings[id]);
        }

        if ($key.attr('type') === 'checkbox') {
            // do not call onChange direct, because onChange could expect some arguments
            $key.prop('checked', settings[id]).change(function () {
                onChange();
            });
        } else {
            // do not call onChange direct, because onChange could expect some arguments
            $key.val(settings[id]).change(function () {
                onChange();
            }).keyup(function () {
                onChange();
            });
        }
    });
    onChange(false);
    M.updateTextFields();  // function Materialize.updateTextFields(); to reinitialize all the Materialize labels on the page if you are dynamically adding inputs.

    list2chips('.blacklistedClients', settings.blacklistedClients || [], onChange);
    list2chips('.blacklistedDevices', settings.blacklistedDevices || [], onChange);
    list2chips('.blacklistedWlans', settings.blacklistedWlans || [], onChange);
    list2chips('.blacklistedNetworks', settings.blacklistedNetworks || [], onChange);
    list2chips('.blacklistedHealth', settings.blacklistedHealth || [], onChange);
}


/**
 * Is called by the admin adapter when the settings page loads
 * @param {*} settings 
 * @param {*} onChange 
 */
async function load(settings, onChange) {
    console.log('Loading settings');

    socket.emit('getObject', 'system.config', function (err, obj) {
        secret = (obj.native ? obj.native.secret : '') || 'Zgfr56gFe87jJOM';
        loadHelper(settings, onChange);
    });

    // $.getJSON("./lib/objects_getClients.json", function(json) {
    //     console.log(JSON.stringify(json)); // this will show the info it in firebug console
    // });

    let obj = await getUnifiObjects('Clients');

    console.log(obj);

    onChange(false);

    console.log('Loading settings done');
}

/**
 * Is called by the admin adapter when the user presses the save button
 * @param {*} callback 
 */
function save(callback) {
    // example: select elements with class=value and build settings object
    const obj = {};
    $('.value').each(function () {
        const $this = $(this);
        const id = $this.attr('id');

        if ($this.attr('type') === 'checkbox') {
            obj[id] = $this.prop('checked');
        } else {
            let value = $this.val();
            if (id === 'controllerPassword') {
                value = encrypt(secret, value);
            }
            obj[id] = value;
        }
    });

    obj.blacklistedClients = chips2list('.blacklistedClients');
    obj.blacklistedDevices = chips2list('.blacklistedDevices');
    obj.blacklistedWlans = chips2list('.blacklistedWlans');
    obj.blacklistedNetworks = chips2list('.blacklistedNetworks');
    obj.blacklistedHealth = chips2list('.blacklistedHealth');

    callback(obj);
}

//#region Funktionen
async function getUnifiObjects(lib) {
    return new Promise((resolve, reject) => {
        $.getJSON(`./lib/objects_get${lib}.json`, function(json) {
            if (json) {
                resolve(json);
            } else {
                resolve(null);
            }
        });
    });
}
//#endregion
