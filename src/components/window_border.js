import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import { WindowCornersEffect } from './window_corners_effect.js';


const BORDER_ACTOR_NAME = 'bms-window-border';
const BLUR_ACTOR_NAME = 'bms-application-blurred-widget';
const CORNERS_EFFECT_NAME = 'bms-window-corners';

// our own actors inside a window actor; anything else is the window content
const BMS_ACTOR_NAMES = [BORDER_ACTOR_NAME, BLUR_ACTOR_NAME];

const BORDERED_FRAME_TYPES = [
    Meta.FrameType.NORMAL,
    Meta.FrameType.DIALOG,
    Meta.FrameType.MODAL_DIALOG
];


/// Draws a border around every application window, blurred or not, and
/// rounds the corners of the window content to the same shape.
///
/// The border is a plain `St.Widget` with a CSS border, added on top of the
/// window's content inside its window actor. Unlike a shader effect it never
/// redirects the window offscreen, so it cannot break the application blur
/// (which blurs what is painted behind the window).
///
/// When the window has an application blur, the border follows the blur's
/// geometry and corner radius, which other extensions (e.g. Rounded Window
/// Corners) may fit to their own window shape. Otherwise it follows the
/// window's frame rect, with the corner radius from the preferences.
///
/// The corners are rounded by a shader on the window's content actor (the
/// surface container), never on the window actor, which also holds the blur.
export const WindowBorder = class WindowBorder {
    constructor(connections, settings, _) {
        this.connections = connections;
        this.settings = settings;
        this.enabled = false;

        // every meta window that currently has a border actor
        this.windows = new Set();
    }

    enable() {
        this._log("adding window borders...");

        this.mutter_gsettings = new Gio.Settings({ schema: 'org.gnome.mutter' });

        global.get_window_actors().forEach(
            window_actor => this.track(window_actor.meta_window)
        );

        this.connections.connect(
            global.display, 'window-created',
            (_meta_display, meta_window) => this.track(meta_window)
        );

        this.enabled = true;
    }

    /// Adds a border to the given meta window, if it does not have one yet.
    track(meta_window) {
        if (!meta_window || meta_window._bms_border)
            return;

        const window_actor = meta_window.get_compositor_private();
        if (!window_actor)
            return;

        const border = new St.Widget({
            name: BORDER_ACTOR_NAME,
            reactive: false,
            visible: false,
        });
        window_actor.add_child(border);

        meta_window._bms_border = border;
        this.windows.add(meta_window);

        this.connections.connect(
            meta_window,
            [
                'size-changed',
                'notify::maximized-horizontally',
                'notify::maximized-vertically',
                'notify::fullscreen',
                'notify::wm-class'
            ],
            _ => this.schedule_update(meta_window)
        );

        this.connections.connect(
            meta_window, 'unmanaging',
            _ => this.untrack(meta_window)
        );

        // keep the border above the content added later on (the surfaces, or
        // the blur actor), and follow a blur actor once there is one
        this.connections.connect(
            window_actor, ['child-added', 'child-removed'],
            _ => {
                if (border.get_parent() === window_actor)
                    window_actor.set_child_above_sibling(border, null);
                this.schedule_update(meta_window);
            }
        );

        this.schedule_update(meta_window);
    }

    /// Removes the border of the given meta window.
    untrack(meta_window) {
        const border = meta_window._bms_border;
        if (!border)
            return;

        this.clear_pending_update(meta_window);
        this.remove_corners(meta_window);

        this.connections.disconnect_all_for(meta_window);
        const window_actor = meta_window.get_compositor_private();
        if (window_actor)
            this.connections.disconnect_all_for(window_actor);
        if (meta_window._bms_border_blur)
            this.connections.disconnect_all_for(meta_window._bms_border_blur);

        border.get_parent()?.remove_child(border);
        border.destroy();

        delete meta_window._bms_border;
        delete meta_window._bms_border_blur;
        this.windows.delete(meta_window);
    }

    /// Updates the border right before the next redraw. This coalesces the
    /// many signals a single change emits, and lets the blur actor be fully
    /// updated (geometry, then corner radius) before we read it.
    schedule_update(meta_window) {
        if (meta_window._bms_border_later)
            return;

        meta_window._bms_border_later = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW,
            () => {
                meta_window._bms_border_later = 0;
                this.update(meta_window);
                return false;
            }
        );
    }

    clear_pending_update(meta_window) {
        if (meta_window._bms_border_later) {
            global.compositor.get_laters().remove(meta_window._bms_border_later);
            meta_window._bms_border_later = 0;
        }
    }

    update_all() {
        this.windows.forEach(meta_window => this.schedule_update(meta_window));
    }

    update(meta_window) {
        const border = meta_window._bms_border;
        const window_actor = meta_window.get_compositor_private();
        if (!border || !window_actor)
            return;

        const prefs = this.settings.window_border;
        const is_maximized = meta_window.maximized_horizontally
            || meta_window.maximized_vertically
            || meta_window.fullscreen;

        let shape = null;
        if (BORDERED_FRAME_TYPES.includes(meta_window.get_frame_type())) {
            const blur_actor = this.follow_blur_actor(meta_window, window_actor);
            shape = (blur_actor && this.blur_shape(blur_actor))
                ?? this.frame_shape(meta_window);
        }
        if (!shape || shape.width <= 0 || shape.height <= 0) {
            border.hide();
            this.update_corners(meta_window, window_actor, null, 0);
            return;
        }

        // a blurred window gives its blur's radius, which already accounts for
        // maximized/fullscreen windows (and for Rounded Window Corners)
        let radius = shape.radius;
        if (radius === undefined) {
            radius = is_maximized && !this.settings.applications.CORNER_WHEN_MAXIMIZED
                ? 0
                : prefs.CORNER_RADIUS;
        }

        // content corners, matching the border and the blur
        this.update_corners(
            meta_window, window_actor, prefs.ROUND_CORNERS ? shape : null, radius
        );

        if (prefs.WIDTH <= 0 || (is_maximized && !prefs.SHOW_WHEN_MAXIMIZED)) {
            border.hide();
            return;
        }

        border.set_position(shape.x, shape.y);
        border.set_size(shape.width, shape.height);

        const [r, g, b, a] = prefs.COLOR;
        const style = `border: ${prefs.WIDTH}px solid rgba(${Math.round(r * 255)}, `
            + `${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a}); `
            + `border-radius: ${radius}px; background-color: transparent;`;
        if (border.style !== style)
            border.style = style;

        border.show();
    }

    /// Rounds the window content to `shape` (window actor coordinates) with
    /// `radius` (unscaled, like CSS pixels), or stops rounding it when `shape`
    /// is null or the radius is 0.
    update_corners(meta_window, window_actor, shape, radius) {
        const content = window_actor.get_children().find(
            child => !BMS_ACTOR_NAMES.includes(child.name)
        ) ?? null;

        // the content actor can be replaced during the window's life
        if (meta_window._bms_corners_target !== content)
            this.remove_corners(meta_window);

        const theme_scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        const scaled_radius = radius * theme_scale;
        if (!content || !shape || scaled_radius < 1) {
            this.remove_corners(meta_window);
            return;
        }

        let effect = content.get_effect(CORNERS_EFFECT_NAME);
        if (!effect) {
            effect = new WindowCornersEffect();
            content.add_effect_with_name(CORNERS_EFFECT_NAME, effect);
            meta_window._bms_corners_target = content;

            // the effect maps its bounds through the content's size
            this.connections.connect(
                content, 'notify::size',
                _ => this.schedule_update(meta_window)
            );
        }

        const x = shape.x - content.x;
        const y = shape.y - content.y;
        effect.set_shape([x, y, x + shape.width, y + shape.height], scaled_radius);
    }

    remove_corners(meta_window) {
        const content = meta_window._bms_corners_target;
        if (!content)
            return;

        delete meta_window._bms_corners_target;
        this.connections.disconnect_all_for(content);
        try {
            content.remove_effect_by_name(CORNERS_EFFECT_NAME);
        } catch (e) {
            // the content actor is already gone
        }
    }

    /// Finds the application blur actor of the window (if any), and makes sure
    /// the border is updated whenever that actor moves or is resized.
    follow_blur_actor(meta_window, window_actor) {
        const blur_actor = window_actor.get_children().find(
            child => child.name === BLUR_ACTOR_NAME
        ) ?? null;

        if (blur_actor !== (meta_window._bms_border_blur ?? null)) {
            if (meta_window._bms_border_blur)
                this.connections.disconnect_all_for(meta_window._bms_border_blur);

            meta_window._bms_border_blur = blur_actor;

            if (blur_actor)
                this.connections.connect(
                    blur_actor,
                    ['notify::x', 'notify::y', 'notify::width', 'notify::height', 'notify::clip-rect'],
                    _ => this.schedule_update(meta_window)
                );
        }

        return blur_actor;
    }

    /// The visible area of the blur actor, in window actor coordinates, with
    /// the corner radius of its effect (unscaled, like CSS pixels).
    blur_shape(blur_actor) {
        if (blur_actor.width <= 0 || blur_actor.height <= 0)
            return null;

        let shape;
        if (blur_actor.has_clip) {
            // static blur: a monitor-sized actor clipped to the window
            const [clip_x, clip_y, clip_width, clip_height] = blur_actor.get_clip();
            shape = {
                x: blur_actor.x + clip_x,
                y: blur_actor.y + clip_y,
                width: clip_width,
                height: clip_height
            };
        } else {
            // dynamic blur: the actor is exactly the blurred area
            shape = {
                x: blur_actor.x,
                y: blur_actor.y,
                width: blur_actor.width,
                height: blur_actor.height
            };
        }

        for (const effect of blur_actor.get_effects()) {
            if ('unscaled_corner_radius' in effect)
                shape.radius = effect.unscaled_corner_radius;
            else if (effect.constructor.name === 'CornerEffect')
                shape.radius = effect.straight_corners ? 0 : effect.radius;
        }

        return shape;
    }

    /// The window's frame rect, in window actor coordinates.
    frame_shape(meta_window) {
        const scale = this.compute_scale(meta_window);
        const frame = meta_window.get_frame_rect();
        const buffer = meta_window.get_buffer_rect();

        return {
            x: (frame.x - buffer.x) / scale,
            y: (frame.y - buffer.y) / scale,
            width: frame.width / scale,
            height: frame.height / scale
        };
    }

    /// Same as `ApplicationsBlur.compute_scale`: window actor coordinates only
    /// need unscaling on Wayland, for native clients, without framebuffer
    /// scaling (always on since GNOME 50).
    compute_scale(meta_window) {
        const gnome_shell_major_version = parseInt(Config.PACKAGE_VERSION.split('.')[0]);
        const scale_monitor_framebuffer =
            gnome_shell_major_version >= 50 ||
            this.mutter_gsettings
                ?.get_strv('experimental-features')
                .includes('scale-monitor-framebuffer');
        const is_wayland = gnome_shell_major_version >= 50 || Meta.is_wayland_compositor();
        const monitor_index = meta_window.get_monitor();

        return !scale_monitor_framebuffer && is_wayland
            && meta_window.get_client_type() == Meta.WindowClientType.WAYLAND
            ? global.display.get_monitor_scale(monitor_index)
            : 1;
    }

    disable() {
        this._log("removing window borders...");

        [...this.windows].forEach(meta_window => this.untrack(meta_window));

        this.connections.disconnect_all();
        delete this.mutter_gsettings;

        this.enabled = false;
    }

    _log(str) {
        if (this.settings.DEBUG)
            console.log(`[Blur my Shell > window border] ${str}`);
    }

    _warn(str) {
        console.warn(`[Blur my Shell > window border] ${str}`);
    }
};
