"""Decimate TheEvidence.glb, bake AO into a bone-tinted vertex color, export Draco GLB."""
import bpy, sys, os, math
import numpy as np
argv = sys.argv[sys.argv.index("--")+1:]
src_dir, target = argv[0], int(argv[1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(src_dir, "TheEvidence.glb"))
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
obj = meshes[0]
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
total = len(obj.data.polygons); ratio = min(1.0, target / total)
m = obj.modifiers.new("Decimate", 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="Decimate")
bpy.ops.object.shade_smooth()
me = obj.data
print("faces after decimate:", len(me.polygons), "verts:", len(me.vertices))

# --- colour attribute (per-vertex, will become COLOR_0)
if "Col" in me.color_attributes: me.color_attributes.remove(me.color_attributes["Col"])
ca = me.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
me.color_attributes.active_color = ca
me.color_attributes.render_color_index = me.color_attributes.find("Col")

# --- material that shows the colour attribute (glTF: COLOR_0 * baseColorFactor)
mat = bpy.data.materials.new("BoneSkull"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
attr = nt.nodes.new("ShaderNodeVertexColor"); attr.layer_name = "Col"
nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.55
bsdf.inputs["Metallic"].default_value = 0.0
me.materials.clear(); me.materials.append(mat)

# --- bake AO into the colour attribute with Cycles
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = False
scene.world = bpy.data.worlds.new("W"); scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.render.bake.target = 'VERTEX_COLORS'
scene.render.bake.use_selected_to_active = False
bpy.ops.object.bake(type='AO')
print("AO baked")

# --- tint: bone colour with subtle variation, multiplied by AO (AO in the attribute's RGB now)
n = len(me.vertices)
ao = np.zeros(n * 4, dtype=np.float32); ca.data.foreach_get("color", ao); ao = ao.reshape(n, 4)[:, 0]
print("AO stats: min %.3f mean %.3f max %.3f" % (ao.min(), ao.mean(), ao.max()))
ao = np.clip(ao, 0, 1)
co = np.zeros(n * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
rng = np.random.default_rng(3)
mott = 0.5 + 0.5 * np.sin(co[:, 0] * 9.1 + co[:, 1] * 7.3) * np.cos(co[:, 2] * 8.7 + co[:, 0] * 3.1)
grain = rng.normal(0, 0.03, n)
def srgb2lin(c): c = np.array(c); return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
bone_light = srgb2lin([0.88, 0.82, 0.68]); bone_dark = srgb2lin([0.58, 0.48, 0.34])   # aged bone, sRGB intent
base = bone_light[None, :] * (1 - 0.45 * mott[:, None]) + bone_dark[None, :] * (0.45 * mott[:, None])
base = base * (1 + grain[:, None])
# AO in linear space: crevices go dark, open bone stays bright
ao_l = ao ** 2.0
shade = 0.06 + 0.94 * ao_l
rgba = np.concatenate([np.clip(base * shade[:, None], 0, 1), np.ones((n, 1))], 1).astype(np.float32)
ca.data.foreach_set("color", rgba.ravel())
me.update()

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(src_dir, "TheEvidence_web.glb"), export_format='GLB',
    export_apply=True, use_selection=True, export_yup=True, export_animations=False,
    export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_color_quantization=10)
print("EXPORTED TheEvidence_web.glb")
