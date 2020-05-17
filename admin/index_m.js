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

    await createChips(settings, onChange);

    await createTreeViews(settings, onChange);

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
            
            value = value.trim();

            if (id === 'controllerPassword') {
                value = encrypt(secret, value);
            }

            obj[id] = value;
        }
    });

    // Process blacklists
    obj.blacklist = {};
    $('[id*=chips_]').each(function () {
        const settingsName = $(this).attr('id').replace('chips_', '');

        obj.blacklist[settingsName] = chips2list(`#chips_${settingsName}`);
    });

    //Process whitelists
    obj.whitelist = {};
    $('[id*=tree_]').each(function () {
        // store selected nodes of tree
        const settingsName = $(this).attr('id').replace('tree_', '');

        const selected = $.ui.fancytree.getTree(`#tree_${settingsName}`).getSelectedNodes();
        const selectedIds = $.map(selected, function (node) {
            return node.data.id;
        });

        const retVal = [];
        for (const id of selectedIds) {
            const dummy = id.split('.');

            let dummy2 = [];
            for (let i = 0; i < dummy.length; i++) {
                if (i === 0) {
                    dummy2 = [];
                }

                dummy2.push(dummy[i]);

                if (!retVal.includes(dummy2.join('.'))) {
                    retVal.push(dummy2.join('.'));
                }
            }
        }

        obj.whitelist[settingsName] = retVal;
    });

    callback(obj);
}


//#region Functions
/**
 * @param {*} settings 
 * @param {*} onChange 
 */
async function createChips(settings, onChange) {
    for (const key of Object.keys(settings.blacklist)) {
        try {
            list2chips(`#chips_${key}`, settings.blacklist[key], onChange);
            M.updateTextFields();  // function Materialize.updateTextFields(); to reinitialize all the Materialize labels on the page if you are dynamically adding inputs.
        } catch (err) {
            console.error(`[createTreeViews] key: ${key} error: ${err.message}, stack: ${err.stack}`);
        }
    }
}

/**
 * @param {*} settings 
 * @param {*} onChange 
 */
async function createTreeViews(settings, onChange) {
    for (const key of Object.keys(settings.whitelist)) {
        try {
            // get json data from file
            const obj = await getUnifiObjects(key);

            // convert json to tree object
            const tree = {
                title: key,
                key: key,
                folder: true,
                expanded: true,
                children: []
            };
            await convertJsonToTreeObject(key, obj[key].logic.has, tree, settings);

            $(`#tree_${key}`).fancytree({
                activeVisible: true,                        // Make sure, active nodes are visible (expanded)
                aria: true,                                 // Enable WAI-ARIA support
                autoActivate: true,                         // Automatically activate a node when it is focused using keyboard
                autoCollapse: false,                         // Automatically collapse all siblings, when a node is expanded
                autoScroll: false,                          // Automatically scroll nodes into visible area
                clickFolderMode: 2,                         // 1:activate, 2:expand, 3:activate and expand, 4:activate (dblclick expands)
                checkbox: true,                             // Show check boxes
                checkboxAutoHide: false,                    // Display check boxes on hover only
                debugLevel: 0,                              // 0:quiet, 1:errors, 2:warnings, 3:infos, 4:debug
                disabled: false,                            // Disable control
                focusOnSelect: false,                       // Set focus when node is checked by a mouse click
                escapeTitles: false,                        // Escape `node.title` content for display
                generateIds: false,                         // Generate id attributes like <span id='fancytree-id-KEY'>
                keyboard: true,                             // Support keyboard navigation
                keyPathSeparator: '/',                      // Used by node.getKeyPath() and tree.loadKeyPath()
                minExpandLevel: 1,                          // 1: root node is not collapsible
                quicksearch: false,                         // Navigate to next node by typing the first letters
                rtl: false,                                 // Enable RTL (right-to-left) mode
                selectMode: 3,                              // 1:single, 2:multi, 3:multi-hier
                tabindex: '0',                              // Whole tree behaves as one single control
                titlesTabbable: false,                      // Node titles can receive keyboard focus
                tooltip: false,                             // Use title as tooltip (also a callback could be specified)
                // icon: function (event, data) {
                //     if (data.node.isFolder()) {
                //         return "unifi.png";
                //     }
                // },
                click: function (event, data) {
                    console.log(data);
                    if (data.targetType === 'title' && !data.node.folder) {
                        data.node.setSelected(!data.node.isSelected());
                    }
                },
                source: [
                    tree
                ],
                select: function (event, data) {
                    // Funktion um alle title auszulesen, kann für Übersetzung verwendet werden -> bitte drin lassen!
                    // var selKeys = $.map(data.tree.getSelectedNodes(), function (node) {
                    //     if (node.children === null) {
                    //         return node.title;
                    //     }
                    // });
                    // console.log(selKeys.join('\n').replace(/_/g, " "));

                    onChange();
                }
            });

            M.updateTextFields();  // function Materialize.updateTextFields(); to reinitialize all the Materialize labels on the page if you are dynamically adding inputs.
        } catch (err) {
            console.error(`[createTreeViews] key: ${key} error: ${err.message}, stack: ${err.stack}`);
        }
    }
}

/**
 * @param {*} name 
 * @param {*} obj 
 * @param {*} tree 
 * @param {*} settings 
 */
async function convertJsonToTreeObject(name, obj, tree, settings) {
    for (const [id, value] of Object.entries(obj)) {
        try {
            let idReadable = id.split('.');
            idReadable = idReadable[idReadable.length - 1];

            const title = value.common.name ? `${idReadable} | ${_(value.common.name)}` : `${idReadable}`;

            if (value && value.type === 'state') {
                if (settings.whitelist[name] && settings.whitelist[name].includes(id)) {
                    tree.children.push({
                        title: title,
                        id: id,
                        selected: true
                    });
                } else {
                    tree.children.push({
                        title: title,
                        id: id
                    });
                }
            } else if (value && value.type === 'channel' || value.type === 'device') {
                const subtree = {
                    title: title,
                    key: id,
                    folder: true,
                    expanded: true,
                    children: []
                };

                await convertJsonToTreeObject(name, value.logic.has, subtree, settings);

                tree.children.push(subtree);
            }
        } catch (err) {
            console.error(`[convertJsonToTreeObject] error: ${err.message}, stack: ${err.stack}`);
        }
    }
}

/**
 * @param {*} lib 
 */
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
