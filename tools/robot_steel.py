"""robot.glb -> robot_web.glb: join, weld, decimate, steel PBR + baked AO in vertex colour, Draco."""
import bpy, sys, os, numpy as np
argv = sys.argv[sys.argv.index("--")+1:]
src_dir, target = argv[0], int(argv[1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(src_dir, "robot.glb"))
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects:
    if o.type != 'MESH': bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='SELECT'); bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active; obj.name = "Robot"; me = obj.data
print("joined faces:", len(me.polygons))
if 'custom_normal' in me.attributes: me.attributes.remove(me.attributes['custom_normal'])
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
ratio = min(1.0, target / len(me.polygons))
if ratio < 1.0:
    m = obj.modifiers.new("Decimate", 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="Decimate")
bpy.ops.object.shade_smooth()
try: bpy.ops.object.shade_auto_smooth(angle=0.61)
except Exception: pass
print("faces after decimate:", len(me.polygons), "verts:", len(me.vertices))

# colour attribute -> COLOR_0
ca = me.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
me.color_attributes.active_color = ca; me.color_attributes.render_color_index = me.color_attributes.find("Col")

# steel material: vertex colour (steel tint * AO) drives base colour
mat = bpy.data.materials.new("Steel"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Metallic"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.42
me.materials.clear(); me.materials.append(mat)

# bake AO (Cycles) into the colour attribute
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48
sc.world = bpy.data.worlds.new("W"); sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
# limit AO reach to ~8% of the model's size so only real crevices darken
import mathutils
size = (mathutils.Vector(obj.bound_box[6]) - mathutils.Vector(obj.bound_box[0])).length
sc.world.light_settings.distance = size * 0.08
print("AO distance:", round(size * 0.08, 3), "of model size", round(size, 3))
sc.render.bake.target = 'VERTEX_COLORS'
bpy.ops.object.bake(type='AO')
n = len(me.vertices)
ao = np.zeros(n * 4, dtype=np.float32); ca.data.foreach_get("color", ao); ao = np.clip(ao.reshape(n, 4)[:, 0], 0, 1)
print("AO stats: min %.3f mean %.3f max %.3f" % (ao.min(), ao.mean(), ao.max()))

def srgb2lin(c): c = np.array(c); return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
steel = srgb2lin([0.78, 0.79, 0.81])          # brushed steel, slightly cool
rng = np.random.default_rng(7); grain = rng.normal(0, 0.02, n)
shade = 0.22 + 0.78 * ao ** 1.4                # crevices dark, open surfaces bright
rgb = steel[None, :] * (1 + grain[:, None]) * shade[:, None]
rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((n, 1))], 1).astype(np.float32)
ca.data.foreach_set("color", rgba.ravel()); me.update()

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(src_dir, "robot_web.glb"), export_format='GLB',
    export_apply=True, use_selection=True, export_yup=True, export_animations=False,
    export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_color_quantization=10)
print("EXPORTED robot_web.glb")
