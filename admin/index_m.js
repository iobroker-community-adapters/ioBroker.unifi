/**
 * Is called by the admin adapter when the settings page loads
 * @param {*} settings 
 * @param {*} onChange 
 */
function load(settings, onChange) {
    console.log('Loading settings');
    
    // Hide Settings
    $('.hideOnLoad').hide();
    $('.showOnLoad').show();
    
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

    onChange(false);

    // reinitialize all the Materialize labels on the page if you are dynamically adding inputs:
    if (M) M.updateTextFields();

    //Show Settings
    $('.hideOnLoad').show();
    $('.showOnLoad').hide();

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
        if ($this.attr('type') === 'checkbox') {
            obj[$this.attr('id')] = $this.prop('checked');
        } else {
            obj[$this.attr('id')] = $this.val();
        }
    });

    callback(obj);
}