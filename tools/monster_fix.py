"""Web copy of Monster.glb: decimate, fix normals, double-sided, Draco."""
import bpy, sys, os, struct, json
argv = sys.argv[sys.argv.index("--")+1:]
src_dir, target = argv[0], int(argv[1])
d=open(os.path.join(src_dir,"Monster.glb"),'rb').read(); ln=struct.unpack('<I',d[12:16])[0]; j=json.loads(d[20:20+ln])
print("SOURCE doubleSided:", [(m['name'], m.get('doubleSided')) for m in j['materials']])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(src_dir,"Monster.glb"))
meshes=[o for o in bpy.data.objects if o.type=='MESH']
total=sum(len(o.data.polygons) for o in meshes); ratio=min(1.0, target/total)
for o in meshes:
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
    me=o.data
    # drop imported custom normals so recalculated ones are used
    if 'custom_normal' in me.attributes: me.attributes.remove(me.attributes['custom_normal'])
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    if ratio<1.0 and len(me.polygons)>2000:
        m=o.modifiers.new("Decimate",'DECIMATE'); m.ratio=ratio; m.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier="Decimate")
    bpy.ops.object.shade_smooth()
    for mat in me.materials:
        if mat: mat.use_backface_culling=False   # -> glTF doubleSided
    print("MESH", o.name, "faces", len(me.polygons))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(src_dir,"Monster_web.glb"), export_format='GLB',
    export_apply=True, use_selection=True, export_yup=True, export_animations=False,
    export_vertex_color='MATERIAL',
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_color_quantization=10)
print("EXPORTED Monster_web.glb")
