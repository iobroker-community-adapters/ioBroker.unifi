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

    await createTreeViews(settings);

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

async function createTreeViews(settings) {

    for (const key of Object.keys(settings.whitelist)) {
        try {
            // get json data from file
            let obj = await getUnifiObjects(key);

            // convert json to tree object
            let tree = { title: key, key: key, folder: true, expanded: true, children: [] };
            await convertJsonToTreeObject(key, obj[key].logic.has, tree, settings);

            $(`#tree_${key}`).fancytree({
                checkbox: true,
                selectMode: 3,
                activeVisible: true,
                // icon: function (event, data) {
                //     if (data.node.isFolder()) {
                //         return "unifi.png";
                //     }
                // },
                source: [
                    tree
                ],
            });

        } catch (err) {
            console.error(`[createTreeViews] key: ${key} error: ${err.message}, stack: ${err.stack}`);
        }
    }
}

async function convertJsonToTreeObject(name, obj, tree, settings) {
    for (const [key, value] of Object.entries(obj)) {
        try {
            if (value && value.type === 'state') {
                let id = key.replace(`${name}.`, '');

                //TODO: use value.common.name for title
                if (settings.whitelist[name] && settings.whitelist[name].includes(id)) {
                    tree.children.push({ title: id, id: id, selected: true })
                } else {
                    tree.children.push({ title: id, id: id })
                }
                
            } else if (value && value.type === 'channel' || value.type === 'device') {
                let id = key.replace(`${name}.`, '');

                //TODO: use was besseres für name;
                let subtree = { title: id, key: id, folder: true, expanded: true, children: [] }

                await convertJsonToTreeObject(name, value.logic.has, subtree, settings);

                tree.children.push(subtree)
            }
        } catch (err) {
            console.error(`[convertJsonToTreeObject] error: ${err.message}, stack: ${err.stack}`);
        }
    }
}

//#region Funktionen
async function getUnifiObjects(lib) {
    return new Promise((resolve, reject) => {
        $.getJSON(`./lib/objects_${lib}.json`, function (json) {
            if (json) {
                resolve(json);
            } else {
                resolve(null);
            }
        });
    });
}
//#endregion
