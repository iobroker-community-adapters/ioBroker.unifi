/**
 * Is called by the admin adapter when the settings page loads
 * @param {*} settings 
 * @param {*} onChange 
 */
function load(settings, onChange) {
    console.log('Loading settings');

    // example: select elements with id=key and class=value and insert value
    if (!settings) return;
    $('.value').each(function () {
        const $key = $(this);
        const id = $key.attr('id');
        if ($key.attr('type') === 'checkbox') {
            // do not call onChange direct, because onChange could expect some arguments
            $key.prop('checked', settings[id])
                .on('change', () => onChange())
            ;
        } else {
            // do not call onChange direct, because onChange could expect some arguments
            $key.val(settings[id])
                .on('change', () => onChange())
                .on('keyup', () => onChange())
            ;
        }
    });

    list2chips('.blacklistedClients', settings.blacklistedClients || [], onChange);
    list2chips('.blacklistedDevices', settings.blacklistedDevices || [], onChange);
    list2chips('.blacklistedNetworks', settings.blacklistedNetworks || [], onChange);
    list2chips('.blacklistedHealth', settings.blacklistedHealth || [], onChange);

    onChange(false);

    // reinitialize all the Materialize labels on the page if you are dynamically adding inputs:
    if (M) M.updateTextFields();

    console.log('Loading settings done');
}

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
 * Is called by the admin adapter when the user presses the save button
 * @param {*} callback 
 */
function save(callback) {
    // example: select elements with class=value and build settings object
    const obj = {};
    $('.value').each(function () {
        const $this = $(this);
        if ($this.attr('type') === 'checkbox') {
            obj[$this.attr('id')] = $this.prop('checked');
        } else {
            obj[$this.attr('id')] = $this.val();
        }
    });

    obj.blacklistedClients = chips2list('.blacklistedClients');
    obj.blacklistedDevices = chips2list('.blacklistedDevices');
    obj.blacklistedNetworks = chips2list('.blacklistedNetworks');
    obj.blacklistedHealth = chips2list('.blacklistedHealth');

    callback(obj);
}