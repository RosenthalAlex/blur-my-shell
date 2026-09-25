import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';


// Rounds the corners of the window's visible frame. Around each corner, a thin
// band just outside the frame is cut too: apps often draw a square outline or
// edge there, which would otherwise stick out of the rounding. The rest of the
// area outside the frame (the client-side shadow) and the frame's straight
// edges are left untouched.
const DECLARATIONS = `
uniform vec4 bounds;
uniform float radius;
uniform float band;
uniform vec2 pixel_step;

float corner_alpha(vec2 p) {
    // how far outside the frame (0 inside it)
    vec2 outside = max(max(bounds.xy - p, p - bounds.zw), vec2(0.0));
    if (max(outside.x, outside.y) > band)
        return 1.0;

    // only the corner squares: along the straight edges d has a 0 component
    vec2 center = clamp(p, bounds.xy + radius, bounds.zw - radius);
    vec2 d = abs(p - center);
    if (min(d.x, d.y) == 0.0)
        return 1.0;

    return clamp(radius - length(d) + 0.5, 0.0, 1.0);
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

    /// `bounds`: [x1, y1, x2, y2] of the visible frame, `radius` of its
    /// corners and width of the `band` cut around them outside the frame, in
    /// the actor's coordinates (logical pixels).
    set_shape(bounds, radius, band) {
        if (!this._uniforms) {
            this._uniforms = {
                bounds: this.get_uniform_location('bounds'),
                radius: this.get_uniform_location('radius'),
                band: this.get_uniform_location('band'),
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
        this.set_uniform_float(this._uniforms.band, 1, [band]);
        this.set_uniform_float(this._uniforms.pixel_step, 2, [1 / width, 1 / height]);
        this.queue_repaint();
    }
});
