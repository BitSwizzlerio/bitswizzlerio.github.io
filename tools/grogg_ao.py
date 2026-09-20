"""Grogg.glb -> Grogg_web.glb: decimate, toad-skin tint + baked AO in vertex colour, Draco."""
import bpy, sys, os, math, mathutils
import numpy as np
argv = sys.argv[sys.argv.index("--")+1:]
src_dir, target = argv[0], int(argv[1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(src_dir, "Grogg.glb"))
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)
obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = obj.data
for vg in list(obj.vertex_groups): obj.vertex_groups.remove(vg)          # stray rig weights
if 'custom_normal' in me.attributes: me.attributes.remove(me.attributes['custom_normal'])
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
ratio = min(1.0, target / len(me.polygons))
if ratio < 1.0:
    m = obj.modifiers.new("Decimate", 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="Decimate")
bpy.ops.object.shade_smooth()
print("faces:", len(me.polygons), "verts:", len(me.vertices))

ca = me.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
me.color_attributes.active_color = ca; me.color_attributes.render_color_index = me.color_attributes.find("Col")

mat = bpy.data.materials.new("ToadSkin"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.5     # slightly moist
bsdf.inputs["Metallic"].default_value = 0.0
me.materials.clear(); me.materials.append(mat)

# --- AO bake, reach limited to ~10% of model size
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 64
sc.world = bpy.data.worlds.new("W"); sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
size = (mathutils.Vector(obj.bound_box[6]) - mathutils.Vector(obj.bound_box[0])).length
sc.world.light_settings.distance = size * 0.10
sc.render.bake.target = 'VERTEX_COLORS'
bpy.ops.object.bake(type='AO')
n = len(me.vertices)
ao = np.zeros(n * 4, dtype=np.float32); ca.data.foreach_get("color", ao); ao = np.clip(ao.reshape(n, 4)[:, 0], 0, 1)
print("AO stats: min %.3f mean %.3f max %.3f" % (ao.min(), ao.mean(), ao.max()))

# --- toad palette (sRGB intent -> linear)
def srgb2lin(c): c = np.array(c, dtype=np.float64); return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
co = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
nrm = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get("normal", nrm); nrm = nrm.reshape(n, 3)
s = 6.0 / size                                    # scale noise to model size
mott = 0.5 + 0.5 * np.sin(co[:, 0] * 9.0 * s + co[:, 1] * 6.5 * s) * np.cos(co[:, 2] * 7.5 * s - co[:, 0] * 4.0 * s)
mott2 = 0.5 + 0.5 * np.sin(co[:, 0] * 23 * s + 1.3) * np.sin(co[:, 2] * 19 * s + co[:, 1] * 17 * s)
mott = np.clip(0.65 * mott + 0.35 * mott2, 0, 1)
rng = np.random.default_rng(11); grain = rng.normal(0, 0.035, n)
olive   = srgb2lin([0.47, 0.54, 0.27])            # back: olive green
dark    = srgb2lin([0.26, 0.31, 0.14])            # blotches: dark moss
belly   = srgb2lin([0.84, 0.76, 0.56])            # underside: warm cream
back = olive[None, :] * (1 - 0.7 * mott[:, None]) + dark[None, :] * (0.7 * mott[:, None])
down = np.clip(-nrm[:, 2] * 1.4 + 0.15, 0, 1)     # normals facing down (Blender Z-up) -> belly
down = down * np.clip(1.2 - (co[:, 2] - co[:, 2].min()) / (np.ptp(co[:, 2]) + 1e-6) * 2.0, 0, 1)
base = back * (1 - down[:, None]) + belly[None, :] * down[:, None]
base = base * (1 + grain[:, None])
shade = 0.15 + 0.85 * ao ** 1.6
rgba = np.concatenate([np.clip(base * shade[:, None], 0, 1), np.ones((n, 1))], 1).astype(np.float32)
ca.data.foreach_set("color", rgba.ravel()); me.update()

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(src_dir, "Grogg_web.glb"), export_format='GLB',
    export_apply=True, use_selection=True, export_yup=True, export_animations=False, export_skins=False,
    export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_color_quantization=10)
print("EXPORTED Grogg_web.glb")
