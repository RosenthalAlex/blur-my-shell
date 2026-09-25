import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';


// Rounds the corners of the window's visible frame, and of the client-side
// shadow around it.
//
// Apps draw their shadow for a square window, so once the window is rounded,
// the shadow's square corner would stick out. In each corner quadrant (inside
// and outside the frame), the shadow is rebuilt from the app's own shadow
// along the two neighbouring straight edges, at the same distance from the
// rounded outline, mixed by angle: a rounded shadow with the app's own color,
// blur and offset. Everything else (the straight edges, the rest of the
// shadow, the window inside the rounding) is left untouched.
//
// Uniforms and values are in the actor's coordinates (logical pixels).
const DECLARATIONS = `
uniform vec4 bounds;
uniform float radius;
uniform vec2 pixel_step;
`;

// Texture lookups must be in the code, not in declared functions: the sampler
// is only declared after the snippet declarations.
const CODE = `
    vec2 size = 1.0 / pixel_step;
    vec2 p = cogl_tex_coord_in[0].xy * size;

    vec2 center = clamp(p, bounds.xy + radius, bounds.zw - radius);
    vec2 d = p - center;
    vec2 ad = abs(d);

    // only the corner quadrants: along the straight edges d has a 0 component
    if (ad.x > 0.0 && ad.y > 0.0) {
        // distance from the rounded outline, negative inside the window
        float dist = length(d) - radius;

        if (dist > -0.5) {
            vec2 s = sign(d);
            float out_dist = max(dist, 1.0);

            // the shadow on the vertical and on the horizontal neighbouring
            // edge, at the same distance outside the frame
            vec2 qx = vec2((s.x > 0.0 ? bounds.z : bounds.x) + s.x * out_dist, center.y);
            vec2 qy = vec2(center.x, (s.y > 0.0 ? bounds.w : bounds.y) + s.y * out_dist);
            qx = clamp(qx, vec2(0.5), size - 0.5);
            qy = clamp(qy, vec2(0.5), size - 0.5);

            // no shadow where the buffer has no margin on that side
            float vx = s.x > 0.0 ? step(bounds.z + 0.5, qx.x) : step(qx.x, bounds.x - 0.5);
            float vy = s.y > 0.0 ? step(bounds.w + 0.5, qy.y) : step(qy.y, bounds.y - 0.5);

            vec4 shadow_x = texture2D(cogl_sampler0, qx * pixel_step) * vx;
            vec4 shadow_y = texture2D(cogl_sampler0, qy * pixel_step) * vy;
            vec4 shadow = mix(shadow_x, shadow_y, ad.y / (ad.x + ad.y)) * cogl_color_in;

            // antialiased edge between the window and the rebuilt shadow
            float coverage = clamp(0.5 - dist, 0.0, 1.0);
            cogl_color_out = mix(shadow, cogl_color_out, coverage);
        }
    }
`;


/// Rounds the actor it is added to (the window's content, never the window
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
