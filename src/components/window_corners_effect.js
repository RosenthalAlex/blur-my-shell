import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';


// Rounds the corners of the window's visible frame. Pixels outside the frame
// (e.g. a client-side shadow) are left untouched, and so is everything inside
// the frame except its corners.
const DECLARATIONS = `
uniform vec4 bounds;
uniform float radius;
uniform vec2 pixel_step;

float corner_alpha(vec2 p) {
    if (p.x < bounds.x || p.x > bounds.z || p.y < bounds.y || p.y > bounds.w)
        return 1.0;

    vec2 center = clamp(p, bounds.xy + radius, bounds.zw - radius);
    return clamp(radius - distance(p, center) + 0.5, 0.0, 1.0);
}
`;

const CODE = `
    vec2 p = cogl_tex_coord_in[0].xy / pixel_step;
    cogl_color_out *= corner_alpha(p);
`;


/// Clips the actor it is added to (the window's content, never the window
/// actor: this is an offscreen effect, and on the window actor it would also
/// redirect the application blur, leaving it nothing behind to blur).
export const WindowCornersEffect = GObject.registerClass({
    GTypeName: 'BmsWindowCornersEffect'
}, class WindowCornersEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        // uniform locations are not available yet at this point (GNOME 50)
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE, false);
    }

    /// `bounds`: [x1, y1, x2, y2] of the visible frame and `radius` of its
    /// corners, in the actor's coordinates (logical pixels).
    set_shape(bounds, radius) {
        if (!this._uniforms) {
            this._uniforms = {
                bounds: this.get_uniform_location('bounds'),
                radius: this.get_uniform_location('radius'),
                pixel_step: this.get_uniform_location('pixel_step'),
            };
        }

        const width = this.actor?.get_width() || 1;
        const height = this.actor?.get_height() || 1;
        const max_radius = Math.max(
            0, Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2
        );

        this.set_uniform_float(this._uniforms.bounds, 4, bounds);
        this.set_uniform_float(this._uniforms.radius, 1, [Math.min(radius, max_radius)]);
        this.set_uniform_float(this._uniforms.pixel_step, 2, [1 / width, 1 / height]);
        this.queue_repaint();
    }
});
