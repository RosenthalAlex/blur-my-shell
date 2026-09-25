import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import { ApplicationRow } from './applications_management/application_row.js';


const make_array = prefs_group => {
    let list_box = prefs_group
        .get_first_child()
        .get_last_child()
        .get_first_child();

    let elements = [];
    let i = 0;
    let element = list_box.get_row_at_index(i);
    while (element) {
        elements.push(element);
        i++;
        element = list_box.get_row_at_index(i);
    }

    return elements;
};


export const Applications = GObject.registerClass({
    GTypeName: 'Applications',
    Template: GLib.uri_resolve_relative(import.meta.url, '../ui/applications.ui', GLib.UriFlags.NONE),
    InternalChildren: [
        'blur',
        'pipeline_choose_row',
        'mode_static',
        'mode_dynamic',
        'sigma_row',
        'sigma',
        'brightness_row',
        'brightness',
        'corner_radius_not_found_row',
        'corner_radius_row',
        'corner_radius',
        'corner_when_maximized_row',
        'corner_when_maximized',
        'opacity',
        'dynamic_opacity',
        'blur_on_overview',
        'unblur_when_fullscreen',
        'enable_all',
        'whitelist',
        'add_window_whitelist',
        'blacklist',
        'add_window_blacklist',
        'window_border',
        'window_border_width',
        'window_border_color',
        'window_border_corner_radius',
        'window_border_show_when_maximized'
    ],
}, class Applications extends Adw.PreferencesPage {
    constructor(preferences, preferences_window, pipelines_manager, pipelines_page) {
        super({});
        this._preferences_window = preferences_window;

        this.preferences = preferences;
        this.pipelines_manager = pipelines_manager;
        this.pipelines_page = pipelines_page;

        this.preferences.applications.settings.bind(
            'blur', this._blur, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        this._pipeline_choose_row.initialize(
            this.preferences.applications, this.pipelines_manager, this.pipelines_page
        );

        this.change_blur_mode(this.preferences.applications.STATIC_BLUR, true);

        this._mode_static.connect('toggled',
            () => this.preferences.applications.STATIC_BLUR = this._mode_static.active
        );
        this.preferences.applications.STATIC_BLUR_changed(
            () => this.change_blur_mode(this.preferences.applications.STATIC_BLUR, false)
        );

        this.preferences.applications.settings.bind(
            'opacity', this._opacity, 'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.preferences.applications.settings.bind(
            'dynamic-opacity', this._dynamic_opacity, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.preferences.applications.settings.bind(
            'blur-on-overview', this._blur_on_overview, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.preferences.applications.settings.bind(
            'unblur-when-fullscreen', this._unblur_when_fullscreen, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.preferences.applications.settings.bind(
            'enable-all', this._enable_all, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.preferences.applications.settings.bind(
            'sigma', this._sigma, 'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.preferences.applications.settings.bind(
            'brightness', this._brightness, 'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.preferences.applications.settings.bind(
            'corner-radius', this._corner_radius, 'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        this.preferences.applications.settings.bind(
            'corner-when-maximized', this._corner_when_maximized, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // window border
        const window_border = this.preferences.window_border;
        window_border.settings.bind(
            'enabled', this._window_border, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        window_border.settings.bind(
            'width', this._window_border_width, 'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        window_border.settings.bind(
            'corner-radius', this._window_border_corner_radius, 'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        window_border.settings.bind(
            'show-when-maximized', this._window_border_show_when_maximized, 'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        const update_border_color_button = () => {
            const rgba = this._window_border_color.get_rgba().copy();
            [rgba.red, rgba.green, rgba.blue, rgba.alpha] = window_border.COLOR;
            this._window_border_color.set_rgba(rgba);
        };
        update_border_color_button();
        window_border.COLOR_changed(update_border_color_button);
        this._window_border_color.connect('color-set', () => {
            const rgba = this._window_border_color.get_rgba();
            window_border.COLOR = [rgba.red, rgba.green, rgba.blue, rgba.alpha];
        });

        // connect 'enable all' button to whitelist/blacklist visibility
        this._enable_all.bind_property(
            'active', this._whitelist, 'visible',
            GObject.BindingFlags.INVERT_BOOLEAN
        );
        this._enable_all.bind_property(
            'active', this._blacklist, 'visible',
            GObject.BindingFlags.DEFAULT
        );

        // make sure that blacklist / whitelist is correctly hidden
        if (this._enable_all.active)
            this._whitelist.visible = false;
        this._blacklist.visible = !this._whitelist.visible;

        // listen to app row addition
        this._add_window_whitelist.connect('clicked',
            () => this.add_to_whitelist()
        );
        this._add_window_blacklist.connect('clicked',
            () => this.add_to_blacklist()
        );

        // add initial applications
        this.add_widgets_from_lists();

        this.preferences.connect('reset', () => {
            this.remove_all_widgets();
            this.add_widgets_from_lists();
        });
    }

    // A way to retriew the whitelist widgets.
    get _whitelist_elements() {
        return make_array(this._whitelist);
    }

    // A way to retriew the blacklist widgets.
    get _blacklist_elements() {
        return make_array(this._blacklist);
    }

    add_widgets_from_lists() {
        this.preferences.applications.WHITELIST.forEach(
            app_name => this.add_to_whitelist(app_name)
        );

        this.preferences.applications.BLACKLIST.forEach(
            app_name => this.add_to_blacklist(app_name)
        );

    }

    close_all_expanded_rows() {
        this._whitelist_elements.forEach(
            element => element.set_expanded(false)
        );
        this._blacklist_elements.forEach(
            element => element.set_expanded(false)
        );
    }

    remove_all_widgets() {
        this._whitelist_elements.forEach(
            element => this._whitelist.remove(element)
        );
        this._blacklist_elements.forEach(
            element => this._blacklist.remove(element)
        );
    }

    add_to_whitelist(app_name = null) {
        let window_row = new ApplicationRow('whitelist', this, app_name);
        this._whitelist.add(window_row);
    }

    add_to_blacklist(app_name = null) {
        let window_row = new ApplicationRow('blacklist', this, app_name);
        this._blacklist.add(window_row);
    }

    update_whitelist_titles() {
        let titles = this._whitelist_elements
            .map(element => element._window_class.buffer.text)
            .filter(title => title != "");

        this.preferences.applications.WHITELIST = titles;
    }

    update_blacklist_titles() {
        let titles = this._blacklist_elements
            .map(element => element._window_class.buffer.text)
            .filter(title => title != "");

        this.preferences.applications.BLACKLIST = titles;
    }

    remove_from_whitelist(widget) {
        this._whitelist.remove(widget);
        this.update_whitelist_titles();
    }

    remove_from_blacklist(widget) {
        this._blacklist.remove(widget);
        this.update_blacklist_titles();
    }

    change_blur_mode(is_static_blur, first_run) {
        this._mode_static.set_active(is_static_blur);
        if (first_run)
            this._mode_dynamic.set_active(!is_static_blur);

        this._pipeline_choose_row.set_visible(is_static_blur);
        this._sigma_row.set_visible(!is_static_blur);
        this._brightness_row.set_visible(!is_static_blur);
        this._corner_radius_row.set_visible(!is_static_blur);
        this._corner_radius_row.set_visible(!is_static_blur && this.preferences.ROUNDED_BLUR_FOUND);
        //this._corner_when_maximized_row.set_visible(!is_static_blur && this.preferences.ROUNDED_BLUR_FOUND);
        this._corner_radius_not_found_row.set_visible(!is_static_blur && !this.preferences.ROUNDED_BLUR_FOUND);
    }
});
